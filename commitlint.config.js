module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // Nova funcionalidade
        "fix", // Correção de bug
        "docs", // Documentação
        "style", // Formatação, missing semi colons, etc
        "refactor", // Refatoração de código
        "perf", // Melhorias de performance
        "test", // Adição de testes
        "build", // Mudanças no sistema de build
        "ci", // Mudanças em arquivos de CI
        "chore", // Outras mudanças que não modificam src ou test
        "revert", // Reverter um commit anterior
      ],
    ],
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
  },
};
