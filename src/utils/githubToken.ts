export const GH_TOKEN_KEY = 'playmove_gh_token';
export const GH_TOKEN_CREATE_URL =
  'https://github.com/settings/personal-access-tokens/new';

export function getGitHubToken(): string | undefined {
  try {
    return sessionStorage.getItem(GH_TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function setGitHubToken(token: string) {
  try {
    if (token) {
      sessionStorage.setItem(GH_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(GH_TOKEN_KEY);
    }
  } catch {
    /* sessionStorage is best-effort only */
  }
}
