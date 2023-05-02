import { configureJest } from '@run-z/project-config';

export default await configureJest({
  coverageThreshold: {
    global: {},
  },
  testTimeout: 10000, // Compilation takes long
});
