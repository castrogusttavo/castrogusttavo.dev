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
              primaryLanguage {
                name
                color
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

  return data.user.pinnedItems.nodes as {
    name: string;
    description: string | null;
    url: string;
    homepageUrl: string | null;
    stargazerCount: number;
    forkCount: number;
    primaryLanguage: { name: string; color: string } | null;
  }[];
}
