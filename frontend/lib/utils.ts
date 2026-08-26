import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The class-name helper every component under components/ui/ imports. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
