import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function maskKey(key: string): string {
  if (!key || key.length < 12) return "••••••••";
  return key.slice(0, 8) + "••••••••";
}
