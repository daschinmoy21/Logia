
import { exec } from 'child_process';
import { rename, rm } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Paths are relative to the project root where 'bun run' is executed
const projectPath = join(process.cwd(), 'src-tauri/src/audio/windows/Windows.csproj');
const outputDir = join(process.cwd(), 'src-tauri/bin');
// Use a temp directory to avoid cluttering bin while building
const tempDir = join(outputDir, 'temp_audio_build');
// Target filename expected by Tauri
const targetBin = join(outputDir, 'AudioCapture-x86_64-pc-windows-msvc.exe');

async function build() {
    if (process.platform !== 'win32') {
        console.log('Skipping Windows audio build on non-Windows platform');
        return;
    }
    console.log('Building AudioCapture...');
    try {
        // Publish to temp directory
        // We use --self-contained true -p:PublishSingleFile=true to get a single exe
        const command = `dotnet publish "${projectPath}" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o "${tempDir}"`;
        console.log(`Running: ${command}`);
        const { stdout, stderr } = await execAsync(command);
        console.log(stdout);
        if (stderr) console.error(stderr);

        // Move the executable
        // The AssemblyName is AudioCapture (set in csproj), so output is AudioCapture.exe
        const sourceBin = join(tempDir, 'AudioCapture.exe');

        console.log(`Moving ${sourceBin} to ${targetBin}`);
        // fs.rename handles overwriting
        await rename(sourceBin, targetBin);

        // Clean up temp dir
        console.log('Cleaning up...');
        await rm(tempDir, { recursive: true, force: true });

        console.log('Audio capture build successful!');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
