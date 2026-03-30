import { spawn } from 'child_process';

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: true,
      windowsHide: true,
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0 && !options.allowNonZeroExit) {
        const detail = String(stderr || stdout || '').trim();
        const firstLine = detail.split('\n').find((line) => line.trim()) || '';

        let message = `Command failed with exit code ${code}`;
        if (firstLine) {
          message = `${message}: ${firstLine}`;
        }

        if (Number(code) === 126) {
          message += ' (the scanner binary exists but is not executable on this machine)';
        }

        const err = new Error(message);
        err.code = code;
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }

      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}
