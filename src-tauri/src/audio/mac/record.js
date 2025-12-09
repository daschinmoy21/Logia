const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const EXECUTABLE_PATH = path.join(__dirname, 'SystemAudioDump');
const PCM_OUTPUT_PATH = path.join(process.cwd(), 'temp_audio.pcm');
const WAV_OUTPUT_PATH = path.join(process.cwd(), 'temp_audio.wav');
// We assume transcribe.py is bundled in resources/src/audio/transcription/
// Since record.js is in resources/src/audio/mac/, we need to go up two levels then into transcription
const TRANSCRIPT_SCRIPT_PATH = path.resolve(__dirname, '../transcription/transcribe.py');

// Try to find a python executable.
// 1. If we had a bundled venv, we'd check that.
// 2. Fallback to system 'python3' or 'python'.
const PYTHON_EXEC_PATH = 'python3';
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 2;

// --- Helper Functions ---

function createWavHeader(dataSize, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(dataSize + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

function convertPcmToWav(pcmPath, wavPath) {
  try {
    const pcmData = fs.readFileSync(pcmPath);
    if (pcmData.length === 0) {
      console.error('PCM file is empty, skipping WAV conversion.');
      return false;
    }
    const wavHeader = createWavHeader(pcmData.length, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
    const wavData = Buffer.concat([wavHeader, pcmData]);
    fs.writeFileSync(wavPath, wavData);
    console.error(`✅ Converted PCM to WAV: ${wavPath}`);
    return true;
  } catch (error) {
    console.error(`❌ Error converting PCM to WAV: ${error.message}`);
    return false;
  }
}

function transcribeWavFile(wavPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PYTHON_EXEC_PATH)) {
      return reject(`Python executable not found at ${PYTHON_EXEC_PATH}. Please run 'npm run setup:mac' from the root directory.`);
    }
    if (!fs.existsSync(TRANSCRIPT_SCRIPT_PATH)) {
      return reject(`Transcription script not found at ${TRANSCRIPT_SCRIPT_PATH}.`);
    }

    const transcriptionProcess = spawn(PYTHON_EXEC_PATH, [TRANSCRIPT_SCRIPT_PATH], {
      cwd: path.dirname(TRANSCRIPT_SCRIPT_PATH)
    });

    let transcript = '';
    let errorOutput = '';
    let isReady = false;

    transcriptionProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (!isReady && output.trim() === 'READY') {
        isReady = true;
        console.error('Transcription model is ready. Sending WAV file path.');
        transcriptionProcess.stdin.write(wavPath + '\n');
        transcriptionProcess.stdin.end(); // End stdin right after writing.
      } else if (isReady) {
        transcript += output; // Accumulate without trimming.
      }
    });

    transcriptionProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    transcriptionProcess.on('close', (code) => {
      if (code === 0 && transcript) {
        resolve(transcript.trim());
      } else {
        reject(`Transcription process exited with code ${code}. Stderr: ${errorOutput}`);
      }
    });

    transcriptionProcess.on('error', (err) => {
      reject(`Failed to start transcription process: ${err.message}`);
    });
  });
}


// --- Main Execution ---

if (!fs.existsSync(EXECUTABLE_PATH)) {
  console.error(`❌ Executable not found at ${EXECUTABLE_PATH}. Please run build.sh first.`);
  process.exit(1);
}

console.error('🎧 Starting audio capture...');

const audioCaptureChild = spawn(EXECUTABLE_PATH, [], { stdio: ['ignore', 'pipe', 'pipe'] });
const pcmStream = fs.createWriteStream(PCM_OUTPUT_PATH);
audioCaptureChild.stdout.pipe(pcmStream);

audioCaptureChild.stderr.on('data', (data) => {
  console.error(`[SystemAudioDump stderr]: ${data.toString()}`);
});

audioCaptureChild.on('error', (error) => {
  console.error(`❌ Failed to start audio capture: ${error.message}`);
  pcmStream.close();
  process.exit(1);
});

const cleanupAndExit = (signal) => {
  console.error(`\n👋 Received ${signal}. Stopping audio capture...`);
  audioCaptureChild.kill('SIGINT');
};

process.on('SIGINT', () => cleanupAndExit('SIGINT'));
process.on('SIGTERM', () => cleanupAndExit('SIGTERM'));

audioCaptureChild.on('exit', (code, signal) => {
  console.error(`Audio capture process exited with code ${code} and signal ${signal}.`);
  pcmStream.end(async () => {
    console.error('PCM stream finished writing.');
    if (!fs.existsSync(PCM_OUTPUT_PATH) || fs.statSync(PCM_OUTPUT_PATH).size === 0) {
      console.error('PCM file is missing or empty. Exiting.');
      process.exit(1);
      return;
    }

    if (!convertPcmToWav(PCM_OUTPUT_PATH, WAV_OUTPUT_PATH)) {
      process.exit(1);
      return;
    }

    try {
      console.error('Starting transcription...');
      const transcript = await transcribeWavFile(WAV_OUTPUT_PATH);
      // The final transcript is the ONLY thing printed to stdout
      console.log(transcript);
    } catch (error) {
      console.error(`❌ Transcription failed: ${error}`);
    } finally {
      // Clean up temporary files
      fs.unlinkSync(PCM_OUTPUT_PATH);
      fs.unlinkSync(WAV_OUTPUT_PATH);
      console.error('🎉 Process completed.');
      process.exit(0);
    }
  });
});