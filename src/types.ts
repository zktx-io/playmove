/** How the user chose to start a project */
export type ProjectSource =
  | { type: "template"; templateId: string }
  | { type: "github"; url: string };

/** A single file in the project */
export interface ProjectFile {
  path: string;
  content: string;
}

/** Loaded project ready for editing */
export interface Project {
  source: ProjectSource;
  files: ProjectFile[];
}
