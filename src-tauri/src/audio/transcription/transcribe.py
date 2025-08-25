# src/transcription/transcribe.py
import sys
import json
import os
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Audio file path not provided"}))
        return
    
    audio_path = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    # Default configuration
    config = {
        "model_path": "base",
        "language": None,
        "temperature": 0.0,
        "best_of": 5,
        "beam_size": 5,
        "patience": 1.0,
        "length_penalty": 1.0
    }
    
    # Load configuration if provided
    if config_path and os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                config.update(json.load(f))
        except Exception as e:
            print(json.dumps({"error": f"Failed to read config: {str(e)}"}))
            return
    
    try:
        # Detect CUDA availability
        device = "cuda" if os.path.exists("/dev/nvidia0") or os.path.exists("CUDA_PATH") else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        
        # Initialize model
        model = WhisperModel(
            config["model_path"], 
            device=device, 
            compute_type=compute_type
        )
        
        # Transcribe audio
        segments, info = model.transcribe(
            audio_path,
            language=config["language"],
            temperature=config["temperature"],
            best_of=config["best_of"],
            beam_size=config["beam_size"],
            patience=config["patience"],
            length_penalty=config["length_penalty"],
            without_timestamps=False
        )
        
        # Prepare result
        result = {
            "text": " ".join([segment.text for segment in segments]),
            "language": info.language,
            "language_probability": info.language_probability,
            "segments": [
                {
                    "text": segment.text,
                    "start": segment.start,
                    "end": segment.end
                }
                for segment in segments
            ]
        }
        
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
