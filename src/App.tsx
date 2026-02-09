import { useState } from "react";
import { Navbar } from "./components/Navbar";
import { Home } from "./components/Home";
import { Playground } from "./components/Playground";
import { getTemplate } from "./templates";
import type { Project, ProjectSource, ProjectFile } from "./types";
import "./App.css";

/** Convert a FileMap (Record<string,string>) to ProjectFile[] */
function toProjectFiles(fileMap: Record<string, string>): ProjectFile[] {
  return Object.entries(fileMap).map(([path, content]) => ({ path, content }));
}

function App() {
  const [project, setProject] = useState<Project | null>(null);

  const handleStart = (source: ProjectSource) => {
    if (source.type === "template") {
      const tpl = getTemplate(source.templateId);
      const fileMap = tpl.files(tpl.defaultName);
      setProject({ source, files: toProjectFiles(fileMap) });
    } else {
      // TODO: fetch Move package from GitHub
      setProject({
        source,
        files: [
          {
            path: "README.md",
            content: `# GitHub Import\n\nLoading from: ${source.url}\n\n> GitHub import is not yet implemented.`,
          },
        ],
      });
    }
  };

  const handleBack = () => setProject(null);

  return (
    <>
      <Navbar />
      {project ? (
        <Playground project={project} onBack={handleBack} />
      ) : (
        <Home onStart={handleStart} />
      )}
    </>
  );
}

export default App;
