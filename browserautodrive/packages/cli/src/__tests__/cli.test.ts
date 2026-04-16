import { execSync } from 'child_process';

describe('CLI', () => {
  it('should show version', () => {
    const output = execSync('node ./bin/cli.js --version', { encoding: 'utf-8' });
    expect(output.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should show help', () => {
    const output = execSync('node ./bin/cli.js --help', { encoding: 'utf-8' });
    expect(output).toContain('browserautodrive');
    expect(output).toContain('run');
    expect(output).toContain('record');
    expect(output).toContain('eval');
  });

  it('should show run command help', () => {
    const output = execSync('node ./bin/cli.js run --help', { encoding: 'utf-8' });
    expect(output).toContain('Run a browser automation task');
    expect(output).toContain('--config');
    expect(output).toContain('--headless');
  });
});
