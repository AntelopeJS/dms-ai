import "./fixture";
import "./pages";
import { writeFixtureSkills } from "./skills";

export function construct(): void {
  writeFixtureSkills();
}

export function start(): void {}
