---------------------------- MODULE ChangeSets ----------------------------
(***************************************************************************)
(* The sidecar's change sets: turns that snapshot the project before and   *)
(* after they edit it, and the owner's Undo and Redo, all through the one  *)
(* lock that `serialize` puts snapshots, restores and Redo on.             *)
(*                                                                         *)
(* A file's content is the set of change sets whose lines it holds. An     *)
(* agent's edit adds its turn's lines; a restore puts a file back as a     *)
(* snapshot holds it, whole (`git checkout <tree> -- <file>`).             *)
(*                                                                         *)
(* Code: sidecar/src/checkpoints/checkpoints.ts (beginTurn, recordTurn,    *)
(* markOverlaps, laterConflicts, undo, redo, serialize) and                *)
(* sidecar/src/checkpoints/shadow-git.ts (snapshot, changedFiles, restore).*)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Turns,           \* one change set per turn, named after it
    Files,           \* the project's files
    MaxQueue,        \* bound: tasks waiting on the lock at once
    ConcurrentTurns, \* a turn may begin while another runs (two chats)
    UndoDuringTurn,  \* Undo and Redo may be asked while a turn runs
    OwnerWaits       \* the owner asks only once the lock has nothing queued

VARIABLES
    content,    \* file -> change sets whose lines it holds
    phase,      \* turn -> idle | starting | running | finishing | done
    bTree,      \* turn -> the "before" snapshot (beforeTree)
    aTree,      \* turn -> the "after" snapshot (afterTree)
    edited,     \* turn -> the files its agent wrote
    overlapped, \* turn -> RunningTurn.isOverlapped
    running,    \* state.running: turns between beginTurn and finish's finally
    met,        \* history: pairs of turns that ran at once
    st,         \* turn -> none | applied | undone (ChangeSetRecord.state)
    num,        \* turn -> ChangeSetRecord.number, 0 while unrecorded
    files,      \* turn -> ChangeSetRecord.files, from changedFiles
    nextNum,    \* store.nextNumber()
    queue,      \* the tasks `serialize` runs one at a time, in order
    last        \* history: what the last step did to the owner's lines

vars == <<content, phase, bTree, aTree, edited, overlapped, running, met,
          st, num, files, nextNum, queue, last>>

Snapshot == [Files -> SUBSET Turns]
Empty == [f \in Files |-> {}]
Quiet(kind) == [k |-> kind, lost |-> {}, ghost |-> {}, missed |-> {}]

Init ==
    /\ content = Empty
    /\ phase = [t \in Turns |-> "idle"]
    /\ bTree = [t \in Turns |-> Empty]
    /\ aTree = [t \in Turns |-> Empty]
    /\ edited = [t \in Turns |-> {}]
    /\ overlapped = [t \in Turns |-> FALSE]
    /\ running = {}
    /\ met = {}
    /\ st = [t \in Turns |-> "none"]
    /\ num = [t \in Turns |-> 0]
    /\ files = [t \in Turns |-> {}]
    /\ nextNum = 1
    /\ queue = <<>>
    /\ last = Quiet("init")

(* beginTurn: markOverlaps, running.add, then the "before" snapshot is    *)
(* queued on the lock (checkpoints.ts beginTurn).                         *)
BeginTurn(t) ==
    /\ phase[t] = "idle"
    /\ ConcurrentTurns \/ running = {}
    /\ Len(queue) < MaxQueue
    /\ phase' = [phase EXCEPT ![t] = "starting"]
    /\ overlapped' = IF running = {} THEN overlapped
                     ELSE [u \in Turns |->
                             IF u \in running \cup {t} THEN TRUE
                             ELSE overlapped[u]]
    /\ met' = met \cup {{t, u} : u \in running}
    /\ running' = running \cup {t}
    /\ queue' = Append(queue, [k |-> "before", t |-> t])
    /\ last' = Quiet("begin")
    /\ UNCHANGED <<content, bTree, aTree, edited, st, num, files, nextNum>>

(* A mutating tool awaits ready(), the "before" snapshot, then writes.     *)
Edit(t, f) ==
    /\ phase[t] = "running"
    /\ t \notin content[f]
    /\ content' = [content EXCEPT ![f] = @ \cup {t}]
    /\ edited' = [edited EXCEPT ![t] = @ \cup {f}]
    /\ last' = Quiet("edit")
    /\ UNCHANGED <<phase, bTree, aTree, overlapped, running, met, st, num,
                   files, nextNum, queue>>

(* finish(): the "after" snapshot is queued on the lock (recordTurn).      *)
Finish(t) ==
    /\ phase[t] = "running"
    /\ Len(queue) < MaxQueue
    /\ phase' = [phase EXCEPT ![t] = "finishing"]
    /\ queue' = Append(queue, [k |-> "after", t |-> t])
    /\ last' = Quiet("finish")
    /\ UNCHANGED <<content, bTree, aTree, edited, overlapped, running, met,
                   st, num, files, nextNum>>

(* laterConflicts: later sets, still applied, sharing a file; newest first.*)
Later(x) == {y \in Turns : st[y] = "applied" /\ num[y] > num[x]
                           /\ files[y] \cap files[x] # {}}
RECURSIVE Desc(_)
Desc(S) == IF S = {} THEN <<>>
           ELSE LET m == CHOOSE y \in S : \A z \in S : num[z] <= num[y]
                IN <<m>> \o Desc(S \ {m})

(* undo(): requireState and the targets run before the lock; the restores *)
(* and markState run on it. includeLater is the dialog's checkbox.        *)
RequestUndo(x, later) ==
    /\ st[x] = "applied"
    /\ OwnerWaits => queue = <<>>
    /\ UndoDuringTurn \/ running = {}
    /\ Len(queue) < MaxQueue
    /\ queue' = Append(queue, [k |-> "undo", x |-> x, later |-> later,
                               targets |-> IF later THEN Desc(Later(x)) \o <<x>>
                                           ELSE <<x>>])
    /\ last' = Quiet("ask")
    /\ UNCHANGED <<content, phase, bTree, aTree, edited, overlapped, running,
                   met, st, num, files, nextNum>>

(* redo(): requireState before the lock, the restore on it.               *)
RequestRedo(x) ==
    /\ st[x] = "undone"
    /\ OwnerWaits => queue = <<>>
    /\ UndoDuringTurn \/ running = {}
    /\ Len(queue) < MaxQueue
    /\ queue' = Append(queue, [k |-> "redo", x |-> x])
    /\ last' = Quiet("ask")
    /\ UNCHANGED <<content, phase, bTree, aTree, edited, overlapped, running,
                   met, st, num, files, nextNum>>

(* shadow-git restore: each listed file back as `tree` holds it.          *)
Restore(c, tree, fs) == [f \in Files |-> IF f \in fs THEN tree[f] ELSE c[f]]
RECURSIVE UndoAll(_, _)
UndoAll(c, ts) == IF ts = <<>> THEN c
                  ELSE UndoAll(Restore(c, bTree[Head(ts)], files[Head(ts)]),
                               Tail(ts))

(* What a restore did to the owner's lines: lines of a set left applied   *)
(* that it removed, lines of an undone set that it put back, and for an   *)
(* Undo with the later sets, later applied sets sharing a file it left.   *)
Effect(kind, c2, st2, x) ==
    [k |-> kind,
     lost |-> {y \in Turns : st2[y] = "applied"
                             /\ \E f \in Files : y \in content[f] /\ y \notin c2[f]},
     ghost |-> {y \in Turns : st2[y] = "undone"
                              /\ \E f \in Files : y \notin content[f] /\ y \in c2[f]},
     missed |-> IF kind = "undoLater"
                THEN {y \in Turns : st2[y] = "applied" /\ num[y] > num[x]
                                    /\ files[y] \cap files[x] # {}}
                ELSE {}]

TakeBefore(t) ==
    /\ bTree' = [bTree EXCEPT ![t] = content]
    /\ phase' = [phase EXCEPT ![t] = "running"]
    /\ last' = Quiet("before")
    /\ UNCHANGED <<content, aTree, edited, overlapped, running, met, st, num,
                   files, nextNum>>

(* recordTurn: snapshot, changedFiles, and a record when any file changed;*)
(* finish's finally drops the turn from state.running.                    *)
TakeAfter(t) ==
    LET changed == {f \in Files : bTree[t][f] # content[f]} IN
    /\ phase' = [phase EXCEPT ![t] = "done"]
    /\ running' = running \ {t}
    /\ IF changed = {}
       THEN UNCHANGED <<st, num, files, aTree, nextNum>>
       ELSE /\ st' = [st EXCEPT ![t] = "applied"]
            /\ num' = [num EXCEPT ![t] = nextNum]
            /\ nextNum' = nextNum + 1
            /\ files' = [files EXCEPT ![t] = changed]
            /\ aTree' = [aTree EXCEPT ![t] = content]
    /\ last' = Quiet("after")
    /\ UNCHANGED <<content, bTree, edited, overlapped, met>>

RunUndo(task) ==
    LET ts == {task.targets[i] : i \in 1..Len(task.targets)}
        c2 == UndoAll(content, task.targets)
        st2 == [y \in Turns |-> IF y \in ts THEN "undone" ELSE st[y]]
    IN /\ content' = c2
       /\ st' = st2
       /\ last' = Effect(IF task.later THEN "undoLater" ELSE "undoAlone",
                         c2, st2, task.x)
       /\ UNCHANGED <<phase, bTree, aTree, edited, overlapped, running, met,
                      num, files, nextNum>>

RunRedo(x) ==
    LET c2 == Restore(content, aTree[x], files[x])
        st2 == [st EXCEPT ![x] = "applied"]
    IN /\ content' = c2
       /\ st' = st2
       /\ last' = Effect("redo", c2, st2, x)
       /\ UNCHANGED <<phase, bTree, aTree, edited, overlapped, running, met,
                      num, files, nextNum>>

RunLock ==
    /\ queue # <<>>
    /\ queue' = Tail(queue)
    /\ LET task == Head(queue) IN
       CASE task.k = "before" -> TakeBefore(task.t)
         [] task.k = "after"  -> TakeAfter(task.t)
         [] task.k = "undo"   -> RunUndo(task)
         [] task.k = "redo"   -> RunRedo(task.x)

Next ==
    \/ RunLock
    \/ \E t \in Turns : BeginTurn(t) \/ Finish(t) \/ \E f \in Files : Edit(t, f)
    \/ \E x \in Turns : RequestUndo(x, TRUE) \/ RequestUndo(x, FALSE)
                        \/ RequestRedo(x)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ content \in Snapshot
    /\ phase \in [Turns -> {"idle", "starting", "running", "finishing", "done"}]
    /\ st \in [Turns -> {"none", "applied", "undone"}]
    /\ running \subseteq Turns
    /\ Len(queue) <= MaxQueue

(* An Undo with the later sets (the dialog's default) never removes lines *)
(* of a change set it leaves Applied.                                     *)
UndoKeepsAppliedLines == last.k = "undoLater" => last.lost = {}

(* Undoing a set alone keeps the later sets' lines (docs: Changes, step 3).*)
UndoAloneKeepsLaterLines == last.k = "undoAlone" => last.lost = {}

(* A Redo never removes lines of a change set that is Applied.            *)
RedoKeepsAppliedLines == last.k = "redo" => last.lost = {}

(* An Undo never puts back lines of a change set that is Undone.          *)
UndoLeavesUndoneLinesOut ==
    last.k \in {"undoLater", "undoAlone"} => last.ghost = {}

(* A Redo never puts back lines of another change set that is Undone.     *)
RedoLeavesUndoneLinesOut == last.k = "redo" => last.ghost = {}

(* An Undo with the later sets leaves no later Applied set on its files.  *)
UndoReachesLaterSets == last.missed = {}

(* A change set not flagged overlapped lists only files its turn edited.  *)
SetHoldsOnlyItsTurnsLines ==
    \A x \in Turns : st[x] # "none" /\ ~overlapped[x] => files[x] \subseteq edited[x]

(* Two turns that ran at once are both flagged overlapped.                *)
ConcurrentTurnsAreFlagged == \A p \in met : \A x \in p : overlapped[x]
=============================================================================
