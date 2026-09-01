// Static content that Handle would otherwise store in Firestore and let you
// edit from a dashboard. Fill these in with your real history — empty
// sections are simply skipped on the page.

import type { Locale } from "./locale";

export const GITHUB_USERNAME = "castrogusttavo";

type Localized = Record<Locale, string>;

export type WorkExperience = {
  role: Localized;
  company: string;
  companyUrl?: string;
  period: string;
  bullets: Localized[];
};

export type Education = {
  degree: Localized;
  institution: string;
  period: string;
};

export const workExperience: WorkExperience[] = [
  {
    role: {
      pt: "Engenheiro Backend & Fundador",
      en: "Backend Engineer & Founder",
    },
    company: "Nexo software, Inc.",
    companyUrl: "https://nexo.coodee.dev",
    period: "2026 — present",
    bullets: [
      {
        pt: "Construí uma arquitetura em camadas (schema → service → repository → Prisma) com tratamento de erros via Result-type em toda a base de código, eliminando exceções cruzando fronteiras de lógica de negócio.",
        en: "Built a layered architecture (schema → service → repository → Prisma) with Result-type error handling across the entire codebase, eliminating exceptions crossing business-logic boundaries.",
      },
      {
        pt: "Implementei autenticação completa — OAuth (Google/GitHub), OTP por e-mail, 2FA via TOTP, hashing com argon2 — e multi-tenancy baseado em workspaces com RBAC de 4 níveis (Owner/Admin/Member/Viewer).",
        en: "Implemented full authentication — OAuth (Google/GitHub), email OTP, TOTP 2FA, argon2 hashing — and workspace-based multi-tenancy with 4-tier RBAC (Owner/Admin/Member/Viewer).",
      },
      {
        pt: "Construí o pipeline de cobrança recorrente (assinaturas, limite de assentos, convites) integrado com o AbacatePay, com aplicação de limites de plano em tempo real.",
        en: "Built the recurring billing pipeline (subscriptions, seat limits, invites) integrated with AbacatePay, with real-time plan-limit enforcement.",
      },
      {
        pt: "Automatizei jobs assíncronos (retenção de dados, ciclo de vida de conta, exportação de dados nos moldes LGPD/GDPR) em um worker dedicado com BullMQ, desacoplado do processo web.",
        en: "Automated async jobs (data retention, account lifecycle, LGPD/GDPR-style data export) in a dedicated BullMQ worker, decoupled from the web process.",
      },
      {
        pt: "Configurei um gate de CI completo — lint, typecheck, testes unitários/integração, cobertura, build e varreduras de segurança (Semgrep, Snyk, Gitleaks) — rodando em todo commit direto na main, sem feature branches.",
        en: "Set up a full CI gate — lint, typecheck, unit/integration tests, coverage, build, and security scans (Semgrep, Snyk, Gitleaks) — running on every commit directly to main, no feature branches.",
      },
      {
        pt: "Conduzi uma auditoria de segurança interna que encontrou e corrigiu 33 problemas antes de qualquer exposição externa.",
        en: "Ran an internal security audit that found and fixed 33 issues before any external exposure.",
      },
    ],
  },
  {
    role: {
      pt: "Engenheiro Backend",
      en: "Backend Engineer",
    },
    company: "Stratus Telecom",
    companyUrl: "https://stratustelecom.com.br",
    period: "2025 — present",
    bullets: [
      {
        pt: "Melhorei a qualidade de código e a manutenibilidade a longo prazo introduzindo testes automatizados (98% de cobertura, partindo de 0%), padrões de projeto consistentes (Repository, Factory, Strategy, Observer, Adapter, Facade, Mapper, Result/Either) e documentação completa interna e de API (OpenAPI/Scalar) — nada disso existia antes.",
        en: "Improved code quality and long-term maintainability by introducing automated testing (98% coverage, up from 0%), consistent design patterns (Repository, Factory, Strategy, Observer, Adapter, Facade, Mapper, Result/Either), and complete internal + API documentation (OpenAPI/Scalar) — all previously nonexistent.",
      },
      {
        pt: "Automatizei todo o pipeline de deploy com Docker (build automático de imagens) e CI/CD via GitHub Actions, reduzindo o tempo de deploy e eliminando erros manuais de release.",
        en: "Automated the entire deployment pipeline with Docker (auto image builds) and CI/CD via GitHub Actions, cutting deployment time and eliminating manual release errors.",
      },
      {
        pt: "Migrei o banco de dados principal de MariaDB para PostgreSQL, eliminando conexões fantasma, melhorando a performance de queries com indexação otimizada e implementando busca full-text avançada.",
        en: "Migrated the core database from MariaDB to PostgreSQL, eliminating ghost connections, boosting query performance through optimized indexing, and implementing advanced full-text search.",
      },
      {
        pt: "Arquitetei um sistema multi-tenant escalável — banco de dados centralizado com mirroring, cache-aside com Redis, edge caching no Next.js e armazenamento de objetos MinIO/S3 — além de Server-Sent Events (SSE) substituindo o WebSocket legado para mensagens em tempo real do WhatsApp Business.",
        en: "Architected a scalable multi-tenant system — centralized database with mirroring, Redis cache-aside backend, Next.js edge caching, and MinIO/S3 object storage — plus Server-Sent Events (SSE) replacing legacy WebSocket for real-time WhatsApp Business messaging.",
      },
      {
        pt: "Contribuí para a entrega de uma suíte completa de produtos abrangendo módulos de CRM, Redes Sociais, WhatsApp Business, ServiceDesk e Guest Wifi, hoje usados por grandes clientes corporativos.",
        en: "Contributed to delivering a full product suite spanning CRM, Social Media, WhatsApp Business, ServiceDesk, and Guest Wifi modules now used by major enterprise clients.",
      },
    ],
  },
  {
    role: {
      pt: "Desenvolvedor Frontend",
      en: "Frontend Developer",
    },
    company: "Adaptworks",
    companyUrl: "https://adapt.works",
    period: "2024 — 2024",
    bullets: [
      {
        pt: "Contribuí para um aumento de 19% nas vendas da empresa entregando melhorias de frontend de alto impacto como parte da iniciativa de rebranding e transformação digital, atuando diretamente em fluxos críticos de conversão.",
        en: "Contributed to a 19% increase in company sales by shipping high-impact frontend improvements as part of the rebranding and digital transformation initiative, working directly on critical conversion flows.",
      },
      {
        pt: "Melhorei a experiência de mais de 7.000 usuários diários aplicando práticas modernas de UI/UX e otimizando os fluxos principais da plataforma, reduzindo atrito nas jornadas mais utilizadas.",
        en: "Improved the experience of 7,000+ daily users by applying modern UI/UX practices and optimizing the platform's core flows, reducing friction in the most-used journeys.",
      },
      {
        pt: "Aumentei a visibilidade orgânica do site liderando otimizações de SEO e performance com HTML semântico e ajustes de runtime, resultando em tempos de carregamento mais rápidos e melhor posicionamento nas buscas.",
        en: "Increased organic site visibility by leading SEO and performance optimizations with semantic HTML and runtime tuning, resulting in faster load times and better search rankings.",
      },
      {
        pt: "Melhorei a segurança de releases futuros refatorando o site institucional e a arquitetura da plataforma, reduzindo dívida técnica e tornando a expansão de funcionalidades mais previsível e segura.",
        en: "Improved the security of future releases by refactoring the institutional site and platform architecture, reducing technical debt and making feature expansion more predictable and safe.",
      },
      {
        pt: "Melhorei a estabilidade da integração com APIs de terceiros reconstruindo componentes de frontend com .NET Framework, Razor, JavaScript e MVVM, eliminando comportamentos inconsistentes em fluxos críticos.",
        en: "Improved third-party API integration stability by rebuilding frontend components with .NET Framework, Razor, JavaScript, and MVVM, eliminating inconsistent behavior in critical flows.",
      },
    ],
  },
];

export const education: Education[] = [
  {
    degree: {
      pt: "Tecnólogo em Ciência da Computação",
      en: "BTech of Computer Science",
    },
    institution: "Fatec Praia Grande",
    period: "2024 — 2027",
  },
];

export const contactHref = "https://cal.com/castrogusttavo/15min";

/**
 * The bio, as a sequence of plain-text runs and links. A link may carry a
 * tooltip — a short aside shown on hover, same widget the contribution graph
 * uses — so the description can point at something without leaving it.
 */
export type DescriptionSegment =
  | { type: "text"; text: Localized }
  | {
      type: "link";
      href: string;
      label: Localized;
      tooltip: Localized;
    };

export const description: DescriptionSegment[] = [
  {
    type: "text",
    text: {
      pt: "Engenheiro backend",
      en: "Backend engineer",
    },
  },
  { type: "text", text: { pt: ".", en: "." } },
];

export const heroBio: Localized = {
  pt: "Hey, sou o Gusttavo, um engenheiro em São Paulo, com 3 anos de experiência, obcecado por open source, experiência do desenvolvedor e queijo.",
  en: "Yo, I'm Gusttavo, an engineer based in Sao Paulo, with 3 years of experience, obsessed with open source, developer experience, and cheese.",
};

/** The two runs of plain text around the Nexo and LinkedIn links in the
    second hero paragraph — link labels themselves ("Nexo", "LinkedIn") don't
    need translation, so only the surrounding prose is localized here. */
export const heroHighlight: {
  prefix: Localized;
  middle: Localized;
  suffix: Localized;
} = {
  prefix: {
    pt: "Atualmente, estou construindo a",
    en: "These days, I'm building",
  },
  middle: {
    pt: ", com lançamento em 14 de setembro, e compartilho meu trabalho no",
    en: ", launching September 14th, and I share my work on",
  },
  suffix: {
    pt: ", onde já ultrapassei 5M de visualizações este ano!",
    en: ", where I've pulled over 5M views this year!",
  },
};

/** The fanned photographs above the footer — "por aí" / "elsewhere". */
export type Photo = {
  src: string;
  /** The file's own pixel dimensions, so the lightbox can size before load. */
  width: number;
  height: number;
  caption: Localized;
};

export const photos: Photo[] = [
  {
    src: "/img/me.png",
    width: 4320,
    height: 5400,
    caption: { pt: "eu", en: "me" },
  },
  {
    src: "/img/strava.png",
    width: 2160,
    height: 2700,
    caption: { pt: "8km - Run XP", en: "8km - Run XP" },
  },
  {
    src: "/img/nexo.png",
    width: 1080,
    height: 1350,
    caption: {
      pt: "Nexo Launch Week — 14 de setembro de 2026",
      en: "Nexo Launch Week — Sep 14, 2026",
    },
  },
  {
    src: "/img/dog-brazil.png",
    width: 1016,
    height: 888,
    caption: {
      pt: "ele também torceu pelo Brasil",
      en: "he rooted for Brazil too",
    },
  },
];
