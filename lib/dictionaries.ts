import type { Locale } from "./locale";

export type Dictionary = {
  toggles: {
    language: string;
    theme: string;
    themeNames: { system: string; light: string; dark: string };
  };
  nav: { writing: string };
  proofOfWork: string;
  performance: string;
  repoLinks: { site: string; source: string };
  workedAt: string;
  hero: { bookCall: string; messageOnX: string };
  experience: { showMore: string; showLess: string };
  education: string;
  elsewhere: string;
  globe: string;
  contact: { lead: string; cta: string };
  writing: {
    heading: string;
    empty: string;
    back: string;
    readMore: string;
    /** Contains a `{{minutes}}` placeholder — plain data, not a function, so
        the whole dictionary can still cross into Client Components as a prop. */
    readingTime: string;
  };
};

const pt: Dictionary = {
  toggles: {
    language: "Mudar idioma",
    theme: "Mudar tema",
    themeNames: { system: "Sistema", light: "Claro", dark: "Escuro" },
  },
  nav: { writing: "escrita" },
  proofOfWork: "provas de trabalho",
  performance: "desempenho",
  repoLinks: { site: "site", source: "código" },
  workedAt: "por onde já passei",
  hero: { bookCall: "agendar uma call", messageOnX: "mensagem no X" },
  experience: { showMore: "ver mais", showLess: "ver menos" },
  education: "formação",
  elsewhere: "por aí",
  globe: "girando por aqui",
  contact: { lead: "bora trocar uma ideia?", cta: "manda um oi" },
  writing: {
    heading: "escrita",
    empty: "nada por aqui ainda — em breve.",
    back: "voltar",
    readMore: "ler mais",
    readingTime: "{{minutes}} min de leitura",
  },
};

const en: Dictionary = {
  toggles: {
    language: "Change language",
    theme: "Change theme",
    themeNames: { system: "System", light: "Light", dark: "Dark" },
  },
  nav: { writing: "writing" },
  proofOfWork: "proof of work",
  performance: "performance",
  repoLinks: { site: "site", source: "source" },
  workedAt: "places i worked at",
  hero: { bookCall: "Book a call", messageOnX: "Message on X" },
  experience: { showMore: "show more", showLess: "show less" },
  education: "education",
  elsewhere: "elsewhere",
  globe: "spinning around here",
  contact: { lead: "wanna chat?", cta: "let's talk" },
  writing: {
    heading: "writing",
    empty: "nothing here yet — soon.",
    back: "back",
    readMore: "read more",
    readingTime: "{{minutes}} min read",
  },
};

const dictionaries: Record<Locale, Dictionary> = { pt, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
