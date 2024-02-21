import type ts from "typescript";

function init(modules: {
  typescript: typeof import("typescript/lib/tsserverlibrary");
}) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const moveUpPatterns: string[] = info.config.moveUpPatterns ?? [
      "@/",
      "\\.{1,2}/", // matches `../` or `./`
    ];
    const moveDownPatterns: string[] = info.config.moveDownPatterns ?? [];
    const moveUpRegexes: RegExp[] = moveUpPatterns.map(
      (pattern) => new RegExp(pattern),
    );
    const moveDownRegexes: RegExp[] = moveDownPatterns.map(
      (pattern) => new RegExp(pattern),
    );

    // Diagnostic logging
    info.project.projectService.logger.info(
      "TSSortImportSuggestionsPlugin: Started",
    );

    // Set up decorator object
    const proxy: ts.LanguageService = Object.create(null);
    for (let k of Object.keys(info.languageService) as Array<
      keyof ts.LanguageService
    >) {
      const x = info.languageService[k]!;
      // @ts-expect-error - JS runtime trickery which is tricky to type tersely
      proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
    }

    // Override completions
    proxy.getCompletionsAtPosition = (
      fileName,
      position,
      options,
      ...restArgs
    ) => {
      const prior = info.languageService.getCompletionsAtPosition(
        fileName,
        position,
        options,
        ...restArgs,
      );
      if (!prior) return;

      prior.entries = prior.entries.map((e) => {
        const newEntry = { ...e };
        const source = e.source;
        if (source) {
          if (moveUpRegexes.some((re) => re.test(source))) {
            // Move this item to the bottom of its previous group, e.g. sortText: `12` -> `111`
            newEntry.sortText =
              e.sortText.slice(0, -1) +
              String.fromCharCode(e.sortText.slice(-1).charCodeAt(0) - 1) +
              "1";
          } else if (moveDownRegexes.some((re) => re.test(source))) {
            // Move this item to the bottom of its group
            // Ref: https://github.com/microsoft/TypeScript/blob/60f93aa83ae644092ace6d729d0f10c42715292f/src/services/completions.ts#L406-L430
            newEntry.sortText = newEntry.sortText + "1";
          }
        }
        return newEntry;
      });

      return prior;
    };

    proxy.getCodeFixesAtPosition = (
      fileName: string,
      start: number,
      end: number,
      errorCodes: readonly number[],
      formatOptions: ts.FormatCodeSettings,
      preferences: ts.UserPreferences,
    ) => {
      const prior = info.languageService.getCodeFixesAtPosition(
        fileName,
        start,
        end,
        errorCodes,
        formatOptions,
        preferences,
      );
      const newFixes = [...prior].sort((a, b) => {
        const aSort = moveUpRegexes.some((re) => re.test(a.description))
          ? -1
          : moveDownRegexes.some((re) => re.test(a.description))
            ? 1
            : 0;
        const bSort = moveUpRegexes.some((re) => re.test(b.description))
          ? -1
          : moveDownRegexes.some((re) => re.test(b.description))
            ? 1
            : 0;
        return aSort - bSort;
      });
      return newFixes;
    };

    return proxy;
  }

  return { create };
}

export = init;
