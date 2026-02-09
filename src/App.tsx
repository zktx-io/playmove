import { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Home } from './components/Home';
import { Playground } from './components/Playground';
import { getTemplate } from './templates';
import { fetchGitHubProject } from './utils/fetchGitHub';
import type { Project, ProjectSource, ProjectFile } from './types';

/** Convert a FileMap (Record<string,string>) to ProjectFile[] */
function toProjectFiles(fileMap: Record<string, string>): ProjectFile[] {
  return Object.entries(fileMap).map(([path, content]) => ({ path, content }));
}

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async (source: ProjectSource) => {
    setError(null);

    if (source.type === 'template') {
      const tpl = getTemplate(source.templateId);
      const fileMap = tpl.files(tpl.defaultName);
      setProject({ source, files: toProjectFiles(fileMap) });
      return;
    }

    // GitHub import
    setLoading(true);
    try {
      const { files } = await fetchGitHubProject(source.url);
      setProject({ source, files: toProjectFiles(files) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setProject(null);
    setError(null);
  };

  return (
    <>
      <Navbar onHome={handleBack} />
      {project ? (
        <Playground project={project} />
      ) : (
        <Home onStart={handleStart} loading={loading} error={error} />
      )}
    </>
  );
}

export default App;
