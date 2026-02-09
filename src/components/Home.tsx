import { useState } from "react";
import { TEMPLATES_INTRO, TEMPLATES_MYSTEN } from "../templates";
import type { ProjectSource } from "../types";
import "./Home.css";

const GH_TOKEN_KEY = "gh_token";
const GH_TOKEN_CREATE_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=PlayMove";

interface HomeProps {
  onStart: (source: ProjectSource) => void;
}

export function Home({ onStart }: HomeProps) {
  const [url, setUrl] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [token, setToken] = useState(
    () => localStorage.getItem(GH_TOKEN_KEY) ?? ""
  );

  const handleGitHub = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onStart({ type: "github", url: trimmed });
  };

  const handleTokenChange = (val: string) => {
    setToken(val);
    if (val) {
      localStorage.setItem(GH_TOKEN_KEY, val);
    } else {
      localStorage.removeItem(GH_TOKEN_KEY);
    }
  };

  return (
    <main className="home">
      {/* Hero */}
      <div className="home__hero">
        <img src="/hero.png" alt="PlayMove" className="home__hero-img" />
        <p className="home__subtitle">
          A playground for Move — pick a template or import from GitHub,
          build and deploy to Sui in seconds.
        </p>
      </div>

      {/* GitHub Import */}
      <div className="home__section">
        <h2 className="home__section-title">
          <img src="/github.svg" alt="" className="home__section-icon" />
          Import from GitHub
        </h2>
        <div className="home__github">
          <div className="home__github-form">
            <input
              className="home__github-input"
              type="text"
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGitHub()}
            />
            <button
              className="home__github-btn"
              onClick={handleGitHub}
              disabled={!url.trim()}
            >
              Go
            </button>
            <button
              className={`home__token-toggle${showToken ? " active" : ""}`}
              onClick={() => setShowToken(!showToken)}
              title="GitHub Token"
            >
              🔑
              {!showToken && token && <span className="home__token-dot" />}
            </button>
          </div>
          {showToken && (
            <div className="home__token-panel">
              <div className="home__token-input-row">
                <input
                  className="home__token-input"
                  type={tokenVisible ? "text" : "password"}
                  placeholder="ghp_xxxx"
                  value={token}
                  onChange={(e) => handleTokenChange(e.target.value)}
                />
                <button
                  className="home__token-btn"
                  onClick={() => setTokenVisible(!tokenVisible)}
                >
                  {tokenVisible ? "Hide" : "Show"}
                </button>
                {token && (
                  <button
                    className="home__token-btn home__token-btn--clear"
                    onClick={() => handleTokenChange("")}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="home__token-footer">
                <span>Stored locally in this browser only.</span>
                <a
                  href={GH_TOKEN_CREATE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="home__token-create"
                >
                  Create token on GitHub
                </a>
              </div>
              <p className="home__token-hint">
                Optional — avoids GitHub API rate limits when importing.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* sui-move-intro-course templates */}
      <div className="home__section">
        <h2 className="home__section-title">
          <img src="/sui.svg" alt="" className="home__section-icon" />
          Start from sui-move-intro-course
          <a
            href="https://github.com/sui-foundation/sui-move-intro-course/"
            target="_blank"
            rel="noopener noreferrer"
            className="home__section-link"
            title="View on GitHub"
          >
            <img src="/github.svg" alt="GitHub" className="home__section-icon" />
          </a>
        </h2>
        <div className="home__tiles">
          {TEMPLATES_INTRO.map((t) => (
            <button
              key={t.id}
              className="home__tile"
              onClick={() => onStart({ type: "template", templateId: t.id })}
            >
              <span className="home__tile-name">{t.label}</span>
              <span className="home__tile-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* MystenLabs examples templates */}
      <div className="home__section">
        <h2 className="home__section-title">
          <img src="/mysten_labs.jpg" alt="" className="home__section-icon" />
          Start from MystenLabs examples
          <a
            href="https://github.com/MystenLabs/sui/tree/main/examples/move"
            target="_blank"
            rel="noopener noreferrer"
            className="home__section-link"
            title="View on GitHub"
          >
            <img src="/github.svg" alt="GitHub" className="home__section-icon" />
          </a>
        </h2>
        <div className="home__tiles">
          {TEMPLATES_MYSTEN.map((t) => (
            <button
              key={t.id}
              className="home__tile"
              onClick={() => onStart({ type: "template", templateId: t.id })}
            >
              <span className="home__tile-name">{t.label}</span>
              <span className="home__tile-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
