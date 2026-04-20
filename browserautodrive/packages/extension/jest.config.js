module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
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
        jsx: "react-jsx",
        types: ["jest-environment-jsdom", "chrome"],
        rootDir: ".",
      },
      diagnostics: {
        ignoreCodes: [2305, 7006],
      },
    }],
  },
  moduleNameMapper: {
    "^.*\\.module\\.css$": "<rootDir>/__mocks__/styleMock.js",
  },
  setupFilesAfterEnv: ["./jest.setup.js"],
};
