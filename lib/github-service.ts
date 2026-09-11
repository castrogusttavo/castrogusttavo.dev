import "server-only";

export async function getSocialAccounts(username: string) {
  const res = await fetch(
    `https://api.github.com/users/${username}/social_accounts`,
    {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 }, // cache 1h
    },
  );

  if (!res.ok) return [];

  return res.json() as Promise<{ provider: string; url: string }[]>;
}

export type PinnedRepo = {
  name: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  openIssueCount: number;
  license: string | null;
  /** Every language GitHub detected, largest share first — not just
      `primaryLanguage`, which drops everything but the top one. */
  languages: { name: string; color: string }[];
  firstCommitDate: string | null;
  commitCount: number | null;
  contributorCount: number | null;
};

type PinnedRepoNode = Omit<
  PinnedRepo,
  | "firstCommitDate"
  | "commitCount"
  | "contributorCount"
  | "languages"
  | "license"
> & {
  languages: { nodes: { name: string; color: string }[] };
  licenseInfo: { name: string } | null;
  issues: { totalCount: number };
};

const REST_HEADERS = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
};

/**
 * GitHub's REST list endpoints paginate with a `Link` header — requesting
 * one item per page makes that header's `rel="last"` page number double as
 * the total item count, and fetching that exact page lands on the oldest
 * item (commits are returned newest-first). Used for both "how many commits"
 * and "what was the first one" in a single request, and reused for
 * contributor counts too.
 */
async function getLastPage(
  url: string,
): Promise<{ res: Response; lastPage: number } | null> {
  const res = await fetch(url, {
    headers: REST_HEADERS,
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;

  const lastPageMatch = res.headers
    .get("link")
    ?.match(/[?&]page=(\d+)>;\s*rel="last"/);

  if (!lastPageMatch) return { res, lastPage: 1 };

  const lastPage = Number(lastPageMatch[1]);
  const lastRes = await fetch(`${url}&page=${lastPage}`, {
    headers: REST_HEADERS,
    next: { revalidate: 3600 },
  });
  if (!lastRes.ok) return null;

  return { res: lastRes, lastPage };
}

async function getCommitStats(
  owner: string,
  repo: string,
): Promise<{ firstCommitDate: string | null; commitCount: number | null }> {
  const result = await getLastPage(
    `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
  );
  if (!result) return { firstCommitDate: null, commitCount: null };

  const commits = await result.res.json();
  return {
    firstCommitDate: commits[0]?.commit?.author?.date ?? null,
    commitCount: result.lastPage,
  };
}

async function getContributorCount(
  owner: string,
  repo: string,
): Promise<number | null> {
  const result = await getLastPage(
    `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=true`,
  );
  return result?.lastPage ?? null;
}

export async function getPinnedRepos(username: string) {
  const query = `
    query($username: String!) {
      user(login: $username) {
        pinnedItems(first: 6, types: [REPOSITORY]) {
          nodes {
            ... on Repository {
              name
              description
              url
              homepageUrl
              stargazerCount
              forkCount
              languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
                nodes {
                  name
                  color
                }
              }
              licenseInfo {
                name
              }
              issues(states: OPEN) {
                totalCount
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { username } }),
    next: { revalidate: 3600 },
  });

  const { data, errors } = await res.json();
  if (errors) throw new Error(errors[0].message);
  if (!res.ok || !data?.user) {
    throw new Error(
      "Failed to authenticate with the GitHub API. Check GITHUB_TOKEN.",
    );
  }

  const nodes = data.user.pinnedItems.nodes as PinnedRepoNode[];

  return Promise.all(
    nodes.map(async ({ languages, licenseInfo, issues, ...repo }) => {
      const [commitStats, contributorCount] = await Promise.all([
        getCommitStats(username, repo.name),
        getContributorCount(username, repo.name),
      ]);

      return {
        ...repo,
        languages: languages.nodes,
        license: licenseInfo?.name ?? null,
        openIssueCount: issues.totalCount,
        ...commitStats,
        contributorCount,
      };
    }),
  ) satisfies Promise<PinnedRepo[]>;
}
