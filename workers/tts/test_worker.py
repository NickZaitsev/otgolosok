import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from generate_sample import loudnorm_measure
from worker import DEFAULT_SILERO_MODEL_PATH, DEFAULT_SILERO_SPEAKER, WorkerApiError, chunks, concatenate_wav, prepare_silero_text, upload_with_recovery, validate_claim_profile, synthesize_silero, silero_compatible
class WorkerTest(unittest.TestCase):
    def test_baya_is_default_silero_speaker(self):
        self.assertEqual(DEFAULT_SILERO_SPEAKER,'baya')
        self.assertEqual(DEFAULT_SILERO_MODEL_PATH.name,'silero-v5_5-ru.pt')
    def test_chunks_preserve_text_and_bound_size(self):
        text='Первое предложение. '+'очень '*180+'длинное. Конец!';result=chunks(text,100)
        self.assertTrue(all(len(item)<=100 for item in result));self.assertEqual(' '.join(result).split(),text.split())
    def test_concatenate_wav(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);inputs=[]
            for index in range(2):
                path=root/f'{index}.wav';inputs.append(path)
                with wave.open(str(path),'wb') as target:target.setparams((1,2,8000,0,'NONE','not compressed'));target.writeframes(b'\0\0'*10)
            output=root/'out.wav';concatenate_wav(inputs,output)
            with wave.open(str(output),'rb') as source:self.assertEqual(source.getnframes(),20)
    def test_claim_profile_must_match_worker(self):
        class Args:engine='silero';speaker='xenia';model_path='missing'
        validate_claim_profile({'profile':{'id':'silero-ru-v1','engine':'silero','speaker':'xenia'}},Args(),'silero-ru-v1')
        with self.assertRaises(RuntimeError):validate_claim_profile({'profile':{'id':'f5-ru-v1','engine':'f5'}},Args(),'silero-ru-v1')
    def test_silero_reports_progress_after_each_chunk(self):
        class Model:
            def save_wav(self,**kwargs):
                with wave.open(kwargs['audio_path'],'wb') as target:target.setparams((1,2,48000,0,'NONE','not compressed'));target.writeframes(b'\0\0'*8)
        class Heartbeat:
            def __init__(self):self.values=[]
            def check(self):pass
            def update(self,stage,percent=None):self.values.append((stage,percent))
        with tempfile.TemporaryDirectory() as directory:
            heartbeat=Heartbeat();synthesize_silero('Фраза. '*200,Path(directory)/'result.wav','unused','xenia','cpu',heartbeat,Model())
            self.assertGreater(len(heartbeat.values),1);self.assertTrue(all(stage=='synthesis' for stage,_ in heartbeat.values))
    def test_silero_compatibility_replaces_unsupported_typography(self):
        self.assertEqual(silero_compatible('1535–1538 — «слухи»'),'1535-1538 - "слухи"')
    def test_prepare_silero_text_normalizes_before_adding_stress(self):
        calls=[]
        class Normalizer:
            def normalize(self,text):calls.append(('normalize',text));return 'Двадцать пять рублей — «итог».'
        def accentor(text):calls.append(('stress',text));return 'Дв+адцать пять рубл+ей — «ит+ог».'
        self.assertEqual(prepare_silero_text('25 руб.',Normalizer(),accentor),'Дв+адцать пять рубл+ей - "ит+ог".')
        self.assertEqual(calls,[('normalize','25 руб.'),('stress','Двадцать пять рублей — «итог».')])
    def test_prepare_silero_text_rejects_empty_stage_output(self):
        class EmptyNormalizer:
            def normalize(self,_text):return ''
        with self.assertRaises(RuntimeError):prepare_silero_text('текст',EmptyNormalizer(),lambda text:text)
    def test_loudnorm_measure_reads_ffmpeg_json(self):
        report='''noise\n{"input_i":"-19.0","input_tp":"-2.0","input_lra":"2.0","input_thresh":"-29.0","target_offset":"0.1"}\nnoise'''
        with patch('generate_sample.subprocess.run',return_value=SimpleNamespace(stderr=report)):
            self.assertEqual(loudnorm_measure(Path('input.wav'))['input_i'],'-19.0')
    def test_invalid_upload_discards_completed_spool_without_resynthesis(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'ready.wav';output.write_bytes(b'wav');manifest=root/'job.json';manifest.write_text('{}')
            class Api:
                @staticmethod
                def lease_headers(job):return {}
                def raw(self,*_args,**_kwargs):raise WorkerApiError(422,'invalid audio')
            value={'job':{'id':'job','leaseToken':'x','leaseGeneration':1},'output':str(output),'uploadId':'upload-id','engine':'mock','speaker':'test'}
            self.assertFalse(upload_with_recovery(Api(),manifest,value));self.assertFalse(output.exists());self.assertFalse(manifest.exists())
if __name__=='__main__':unittest.main()
