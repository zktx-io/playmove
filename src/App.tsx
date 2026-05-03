import { useRef, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Home } from './components/Home';
import { Playground } from './components/Playground';
import { getTemplate } from './templates';
import { fetchGitHubProject } from './utils/fetchGitHub';
import { createLoadedProject } from './utils/projectFiles';
import type { Project, ProjectSource } from './types';

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const handleStart = async (source: ProjectSource) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    setError(null);

    if (source.type === 'template') {
      const tpl = getTemplate(source.templateId);
      const fileMap = tpl.files(tpl.defaultName);
      setLoading(false);
      setProject(createLoadedProject(source, fileMap));
      return;
    }

    // GitHub import
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const { files, packageRoot } = await fetchGitHubProject(
        source.url,
        undefined,
        { signal: controller.signal },
      );
      if (requestIdRef.current !== requestId) return;
      setProject(createLoadedProject(source, files, packageRoot));
    } catch (err) {
      if (controller.signal.aborted || requestIdRef.current !== requestId)
        return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  };

  const handleBack = () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setProject(null);
    setError(null);
    setLoading(false);
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
