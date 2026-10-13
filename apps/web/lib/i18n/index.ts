import { en, type Messages } from "./en";

/**
 * Every text the app shows. The app is English only (D-38); keeping the text in one file
 * means no sentence is written inside a component, and a second language stays a file away.
 */
export const useT = (): Messages => en;
