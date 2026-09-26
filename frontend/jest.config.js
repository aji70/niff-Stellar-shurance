const nextJest = require("next/jest.js");

const createJestConfig = nextJest({ dir: "./" });

const ESM_PACKAGES = ["@creit\\.tech", "@stellar", "@preact", "preact", "htm", "@twind", "msw", "@mswjs", "until-async", "@bundled-es-modules"].join("|");

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^next-intl(.*)$": "<rootDir>/src/__mocks__/next-intl.ts",
    "^use-intl(.*)$": "<rootDir>/src/__mocks__/next-intl.ts",
  },
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.tsx",
    "**/src/**/*.test.ts",
    "**/src/**/*.test.tsx",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/e2e/",
    "<rootDir>/tests/",
    "<rootDir>/specs/",
  ],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts", "<rootDir>/jest.flaky-retry.js"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/*.stories.{ts,tsx}",
    "!src/**/__tests__/**",
    "!src/**/__mocks__/**",
    "!src/**/mocks/**",
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.test.json",
    },
  },
};

// nextJest sets its own transformIgnorePatterns; override after merge.
async function jestConfig() {
  const nextConfig = await createJestConfig(config)();
  return {
    ...nextConfig,
    transformIgnorePatterns: [
      `/node_modules/(?!(${ESM_PACKAGES})/)`,
    ],
  };
}

module.exports = jestConfig;
