import { moment as obsidianMoment } from "obsidian";
import type MomentNs from "moment";

// obsidian.d.ts types `moment` as a namespace import, which TS 7 (esModuleInterop always on)
// no longer treats as callable. Same runtime object, callable type.
export const moment = obsidianMoment as unknown as typeof MomentNs;
