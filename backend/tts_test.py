from TTS.api import TTS
import glob

tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
wavs = glob.glob("voice_samples/*.wav")
tts.tts_to_file(text="Mondj 3 mondatot a világrol, amiben biztos vagy!", language="hu", speaker_wav=wavs, file_path="test_output.wav")
print("Done — play test_output.wav")
