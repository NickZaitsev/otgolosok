import tempfile
import unittest
import wave
from pathlib import Path
from worker import chunks, concatenate_wav
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
if __name__=='__main__':unittest.main()
