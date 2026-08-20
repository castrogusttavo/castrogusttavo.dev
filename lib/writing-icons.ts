import type { IconSvgElement } from "@hugeicons/react";
import {
  Book02Icon,
  Bug01Icon,
  Idea01Icon,
  Note01Icon,
  PenTool02Icon,
  Rocket01Icon,
  SourceCodeIcon,
  TerminalIcon,
} from "@hugeicons-pro/core-bulk-rounded";

/**
 * Frontmatter names a post's icon by a short key rather than the Hugeicons
 * export directly — the .md file shouldn't have to know the package's exact
 * naming (`PenTool02Icon` vs `PenTool01Icon`), and a typo falls back instead
 * of failing the build.
 */
export const WRITING_ICONS: Record<string, IconSvgElement> = {
  pen: PenTool02Icon,
  book: Book02Icon,
  code: SourceCodeIcon,
  idea: Idea01Icon,
  note: Note01Icon,
  terminal: TerminalIcon,
  bug: Bug01Icon,
  rocket: Rocket01Icon,
};

export const DEFAULT_WRITING_ICON = Note01Icon;

export function resolveWritingIcon(name: string | undefined): IconSvgElement {
  if (!name) return DEFAULT_WRITING_ICON;
  return WRITING_ICONS[name] ?? DEFAULT_WRITING_ICON;
}
