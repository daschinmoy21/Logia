# src/transcription/transcribe.py
import sys
import json
import os


def main():
    print("Python transcription script started", file=sys.stderr)
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Audio file path not provided"}))
        return

    audio_path = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"Audio path: {audio_path}", file=sys.stderr)
    print(f"Config path: {config_path}", file=sys.stderr)
    print(f"Python executable: {sys.executable}", file=sys.stderr)
    print(f"Python path: {sys.path[:3]}...", file=sys.stderr)

    # Default configuration
    config = {
        "model_path": "base",
        "language": None,
        "temperature": 0.0,
        "best_of": 5,
        "beam_size": 5,
        "patience": 1.0,
        "length_penalty": 1.0,
    }

    # Load configuration if provided
    if config_path and os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                config.update(json.load(f))
            print(f"Loaded config: {config}", file=sys.stderr)
        except Exception as e:
            print(json.dumps({"error": f"Failed to read config: {str(e)}"}))
            return

    # Check if faster_whisper is available
    print("Checking if faster_whisper is available...", file=sys.stderr)
    faster_whisper_available = False

    try:
        from faster_whisper import WhisperModel

        faster_whisper_available = True
        print("faster_whisper is available, using real transcription", file=sys.stderr)
    except ImportError as e:
        print(f"faster_whisper is not available: {e}", file=sys.stderr)
        print("faster_whisper not available, using mock transcription", file=sys.stderr)
        faster_whisper_available = False

    try:
        from faster_whisper import WhisperModel

        faster_whisper_available = True
        print("faster_whisper is available, using real transcription", file=sys.stderr)
    except ImportError as e:
        print(f"faster_whisper is not available: {e}", file=sys.stderr)
        print("Attempting to install faster-whisper...", file=sys.stderr)

        try:
            import subprocess

            # Check pip
            pip_result = subprocess.run(
                [sys.executable, "-m", "pip", "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if pip_result.returncode == 0:
                print(f"Pip available: {pip_result.stdout.strip()}", file=sys.stderr)
            else:
                print(f"Pip not available: {pip_result.stderr}", file=sys.stderr)
                raise Exception("Pip not available")

            # Try installing globally first, then user
            install_commands = [
                [sys.executable, "-m", "pip", "install", "faster-whisper"],
                [sys.executable, "-m", "pip", "install", "--user", "faster-whisper"],
            ]

            install_success = False
            for cmd in install_commands:
                print(f"Trying install command: {cmd}", file=sys.stderr)
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode == 0:
                    print("Successfully installed faster-whisper", file=sys.stderr)
                    install_success = True
                    break
                else:
                    print(f"Install command failed: {result.stderr}", file=sys.stderr)

            if install_success:
                try:
                    from faster_whisper import WhisperModel

                    faster_whisper_available = True
                    print("Import successful after installation", file=sys.stderr)
                except ImportError as import_error:
                    print(
                        f"Still failed to import after installation: {import_error}",
                        file=sys.stderr,
                    )
                    faster_whisper_available = False
            else:
                print("All installation attempts failed", file=sys.stderr)
                faster_whisper_available = False

        except Exception as install_error:
            print(f"Installation error: {install_error}", file=sys.stderr)
            faster_whisper_available = False

    try:
        if not faster_whisper_available:
            # Mock transcription for testing
            result = {
                "text": "This is a mock transcription. Please install faster-whisper to get real transcription. Run: pip install faster-whisper",
                "language": "en",
                "language_probability": 1.0,
                "segments": [
                    {"text": "This is a mock transcription.", "start": 0.0, "end": 5.0}
                ],
            }
            print(json.dumps(result))
            return

        print("Detecting device...", file=sys.stderr)
        # Force CPU mode - the nixpkgs ctranslate2 doesn't have CUDA support
        # To enable CUDA, install ctranslate2 with CUDA support
        device = "cpu"
        compute_type = "int8"

        print(f"Using device: {device}, compute_type: {compute_type}", file=sys.stderr)

        print("Initializing Whisper model...", file=sys.stderr)
        # Initialize model
        model = WhisperModel(
            config["model_path"], device=device, compute_type=compute_type
        )
        print("Model initialized", file=sys.stderr)

        print("Starting transcription...", file=sys.stderr)
        # Transcribe audio
        segments, info = model.transcribe(
            audio_path,
            language=config["language"],
            temperature=config["temperature"],
            best_of=config["best_of"],
            beam_size=config["beam_size"],
            patience=config["patience"],
            length_penalty=config["length_penalty"],
            without_timestamps=False,
        )
        print("Transcription completed", file=sys.stderr)

        # Prepare result
        result = {
            "text": " ".join([segment.text for segment in segments]),
            "language": info.language,
            "language_probability": info.language_probability,
            "segments": [
                {"text": segment.text, "start": segment.start, "end": segment.end}
                for segment in segments
            ],
        }

        print(
            f"Transcription result text length: {len(result['text'])}", file=sys.stderr
        )
        print(json.dumps(result))
    except Exception as e:
        print(f"Exception in transcription: {str(e)}", file=sys.stderr)
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
