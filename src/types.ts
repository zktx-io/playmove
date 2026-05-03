/** How the user chose to start a project */
export type ProjectSource =
  | { type: 'template'; templateId: string }
  | { type: 'github'; url: string };

/** Map of package-root-relative file path to file content. */
export type FileMap = Record<string, string>;

/** Loaded project ready for editing */
export interface LoadedProject {
  source: ProjectSource;
  files: FileMap;
  packageRoot: string;
}

export type Project = LoadedProject;
