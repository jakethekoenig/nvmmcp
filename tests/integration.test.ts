// Integration test for nvmmcp
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Longer timeout for integration tests
const TEST_TIMEOUT = 30000;

// Simple mock test just to verify the setup works in CI
describe('nvmmcp basic test', () => {
  test('verify neovim is installed', () => {
    // Just run a basic test to verify that Neovim is accessible
    const result = childProcess.spawnSync('nvim', ['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toContain('NVIM');
  });
  
  test('verify neovim can create file', async () => {
    // Create a temporary directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmmcp-test-'));
    const testFile = path.join(tempDir, 'test.txt');
    
    // Use Neovim to create a file
    const nvimCmd = `nvim -c "normal! iHello from test" -c "w ${testFile}" -c q!`;
    const result = childProcess.spawnSync('bash', ['-c', nvimCmd], {
      stdio: 'pipe'
    });
    
    // Wait a moment for the file to be created
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check the file was created and has the expected content
    expect(fs.existsSync(testFile)).toBe(true);
    const content = fs.readFileSync(testFile, 'utf8');
    expect(content).toContain('Hello from test');
    
    // Clean up
    fs.unlinkSync(testFile);
    fs.rmdirSync(tempDir);
  });
});
