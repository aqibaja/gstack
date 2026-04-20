module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@browserautodrive/core$": "<rootDir>/../core/src/index.ts",
    "^@browserautodrive/(.*)$": "<rootDir>/../$1/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: {
        target: "ES2022",
        module: "commonjs",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: false,
        allowSyntheticDefaultImports: true,
        moduleResolution: "node",
      },
      diagnostics: {
        ignoreCodes: [2305, 7006],
      },
    }],
  },
};
