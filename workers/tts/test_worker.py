import tempfile
import unittest
import wave
from pathlib import Path
from worker import WorkerApiError, chunks, concatenate_wav, upload_with_recovery, validate_claim_profile
class WorkerTest(unittest.TestCase):
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
