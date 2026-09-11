import type { Locale } from "./locale";

export type Dictionary = {
  toggles: {
    language: string;
    theme: string;
    themeNames: { system: string; light: string; dark: string };
  };
  nav: {
    home: string;
    writing: string;
    project: string;
    search: string;
    searchPlaceholder: string;
    noResults: string;
    resultPost: string;
    resultProject: string;
  };
  proofOfWork: string;
  performance: string;
  repoLinks: { site: string; source: string };
  workedAt: string;
  hero: { bookCall: string; messageOnX: string };
  contributions: {
    graphTitle: string;
    tooltipOne: string;
    tooltipOther: string;
    footerPrefix: string;
    months: string[];
    legend: { less: string; more: string };
  };
  experience: { showMore: string; showLess: string };
  education: string;
  elsewhere: string;
  globe: string;
  contact: { lead: string; cta: string };
  writing: {
    heading: string;
    description: string;
    empty: string;
    /** Contains a `{{minutes}}` placeholder — plain data, not a function, so
        the whole dictionary can still cross into Client Components as a prop. */
    readingTime: string;
  };
  project: {
    heading: string;
    description: string;
    empty: string;
    stars: string;
    commits: string;
    contributors: string;
    license: string;
    openIssues: string;
  };
};

const pt: Dictionary = {
  toggles: {
    language: "Mudar idioma",
    theme: "Mudar tema",
    themeNames: { system: "Sistema", light: "Claro", dark: "Escuro" },
  },
  nav: {
    home: "início",
    writing: "escrita",
    project: "projetos",
    search: "buscar",
    searchPlaceholder: "Buscar posts e projetos…",
    noResults: "Nenhum resultado.",
    resultPost: "post",
    resultProject: "projeto",
  },
  proofOfWork: "provas de trabalho",
  performance: "produtividade",
  repoLinks: { site: "site", source: "código" },
  workedAt: "por onde já passei",
  hero: { bookCall: "agendar uma call", messageOnX: "mensagem no X" },
  contributions: {
    graphTitle: "Contribuições no GitHub",
    tooltipOne: "{{count}} contribuição em {{date}}",
    tooltipOther: "{{count}} contribuições em {{date}}",
    footerPrefix: "{{count}} contribuições no último ano no",
    months: [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ],
    legend: { less: "Menos", more: "Mais" },
  },
  experience: { showMore: "ver mais", showLess: "ver menos" },
  education: "formação",
  elsewhere: "por aí",
  globe: "girando por aqui",
  contact: { lead: "bora trocar uma ideia?", cta: "manda um oi" },
  writing: {
    heading: "escrita",
    description:
      "Artigos sobre arquitetura de software, engenharia e algoritmos, escritos a partir de decisões e problemas reais de produção.",
    empty: "nada por aqui ainda — em breve.",
    readingTime: "{{minutes}} min de leitura",
  },
  project: {
    heading: "projetos",
    description: "Projetos e repositórios fixados no GitHub.",
    empty: "nada fixado ainda.",
    stars: "estrelas",
    commits: "commits",
    contributors: "contribuidores",
    license: "licença",
    openIssues: "issues abertas",
  },
};

const en: Dictionary = {
  toggles: {
    language: "Change language",
    theme: "Change theme",
    themeNames: { system: "System", light: "Light", dark: "Dark" },
  },
  nav: {
    home: "home",
    writing: "writing",
    project: "projects",
    search: "search",
    searchPlaceholder: "Search posts and projects…",
    noResults: "No results.",
    resultPost: "post",
    resultProject: "project",
  },
  proofOfWork: "proof of work",
  performance: "performance",
  repoLinks: { site: "site", source: "source" },
  workedAt: "places i worked at",
  hero: { bookCall: "Book a call", messageOnX: "Message on X" },
  contributions: {
    graphTitle: "GitHub Contributions",
    tooltipOne: "{{count}} contribution on {{date}}",
    tooltipOther: "{{count}} contributions on {{date}}",
    footerPrefix: "{{count}} contributions in last year on",
    months: [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    legend: { less: "Less", more: "More" },
  },
  experience: { showMore: "show more", showLess: "show less" },
  education: "education",
  elsewhere: "elsewhere",
  globe: "spinning around here",
  contact: { lead: "wanna chat?", cta: "let's talk" },
  writing: {
    heading: "writing",
    description:
      "Articles on software architecture, engineering, and algorithms, grounded in real production decisions and problems.",
    empty: "nothing here yet — soon.",
    readingTime: "{{minutes}} min read",
  },
  project: {
    heading: "projects",
    description: "Pinned projects and repositories from GitHub.",
    empty: "nothing pinned yet.",
    stars: "stars",
    commits: "commits",
    contributors: "contributors",
    license: "license",
    openIssues: "open issues",
  },
};

const dictionaries: Record<Locale, Dictionary> = { pt, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
