export default {
  // Enable experimental VM modules for dynamic import of ES modules
  nodeOptions: '--experimental-vm-modules',
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    // The server source imports with explicit .ts extensions (Bun resolves these
    // natively). ts-jest rejects that unless allowImportingTsExtensions is on, which
    // in turn requires noEmit — neither is set in the root tsconfig, which targets Bun.
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        allowImportingTsExtensions: true,
        noEmit: true,
        esModuleInterop: true,
      },
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  // Adjust the root directory if needed

};
