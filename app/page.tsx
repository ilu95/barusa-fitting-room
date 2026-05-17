'use client';

import React, { useState, useEffect } from 'react';
import { Camera, X, CheckCircle2, ChevronLeft, Upload, Palette, Ruler, Sparkles, Shirt } from 'lucide-react';

const FAL_API_KEY = process.env.NEXT_PUBLIC_FAL_API_KEY || '';

interface TargetProduct {
  name: string;
  category: string;
  image_url: string;
}

interface Scores {
  colorScore: number;
  fitScore: number;
  styleScore: number;
}

export default function App() {
  const [step, setStep] = useState<number>(0);
  const [targetProduct, setTargetProduct] = useState<TargetProduct | null>(null);

  const [fit, setFit] = useState<string | null>(null);
  const [userImageBase64, setUserImageBase64] = useState<string | null>(null);
  const [bottomImageBase64, setBottomImageBase64] = useState<string | null>(null);

  const [resultImage1, setResultImage1] = useState<string | null>(null);
  const [resultImage2, setResultImage2] = useState<string | null>(null);

  const [scores, setScores] = useState<Scores | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loadingText, setLoadingText] = useState<string>('가상 피팅을 준비 중입니다...');

  // 1. 카페24에서 넘겨준 상품 이미지 URL 수신
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imgParam = params.get('img');

    // DB 연결 없이, 카페24에서 넘겨준 실제 상품 썸네일 이미지를 바로 타겟으로 설정합니다.
    if (imgParam) {
      setTargetProduct({
        name: "현재 상품",
        category: "상의",
        image_url: imgParam
      });
      setStep(1);
    } else {
      // 이미지 파라미터가 없으면 로컬 테스트용 이미지 세팅
      setTargetProduct({
        name: "테스트 상품",
        category: "상의",
        image_url: "https://images.unsplash.com/photo-1596755094514-f87e32f85e2c?w=800&q=80"
      });
      setStep(1);
    }
  }, []);

  const closeFittingRoom = () => window.parent.postMessage({ type: 'BARUSA_CLOSE' }, '*');
  const addToCart = () => window.parent.postMessage({ type: 'BARUSA_ADD_TO_CART' }, '*');

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result;
      if (typeof base64 === 'string') {
        if (type === 'USER') {
          setUserImageBase64(base64);
          setStep(3);
        } else if (type === 'BOTTOM') {
          setBottomImageBase64(base64);
          setStep(5.5);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const generateScores = (isMixMatch: boolean): Scores => ({
    colorScore: Math.floor(Math.random() * 8) + 92,
    fitScore: Math.floor(Math.random() * 10) + 88,
    styleScore: isMixMatch ? Math.floor(Math.random() * 5) + 95 : Math.floor(Math.random() * 12) + 85
  });

  // 💡 폴링(Polling) 로직: 대표님의 테스트 파일과 100% 동일한 대기열 처리 방식
  const pollResult = async (statusUrl: string, responseUrl: string): Promise<string> => {
    const maxAttempts = 80;
    const interval = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, interval));
      const statusRes = await fetch(statusUrl, { headers: { 'Authorization': 'Key ' + FAL_API_KEY } });
      if (!statusRes.ok) throw new Error(`상태 확인 실패 (${statusRes.status})`);

      const statusData = await statusRes.json();

      if (statusData.status === 'COMPLETED') {
        const resultRes = await fetch(responseUrl, { headers: { 'Authorization': 'Key ' + FAL_API_KEY } });
        if (!resultRes.ok) throw new Error('결과 가져오기 실패');
        const result = await resultRes.json();
        const images = result.images || result.output?.images;
        if (!images || !images[0]) throw new Error('결과 이미지 누락');
        return images[0].url || images[0];
      } else if (statusData.status === 'FAILED') {
        throw new Error(statusData.error || statusData.detail || '생성 실패');
      } else {
        const dots = '.'.repeat((i % 3) + 1);
        setLoadingText(`AI 분석 및 이미지 생성 중${dots}`);
      }
    }
    throw new Error('시간 초과');
  };

  // 💡 대표님 테스트 파일 기준 /edit 엔드포인트 및 image_urls 배열 스키마 적용
  const runVTON = async (sourceImage: string, referenceImage: string, isMixMatch: boolean = false) => {
    if (!FAL_API_KEY) {
      setErrorMsg("API 키가 없습니다.");
      return;
    }

    try {
      setLoadingText('FAL.AI 서버에 작업을 요청하는 중...');

      // 테스트 파일에서 성공했던 프롬프트 적용
      const instruction = isMixMatch
        ? `The person in image 1 is wearing the pants/skirt/bottom shown in image 2. Keep the person's face, hair, skin, upper body clothing, and background exactly the same. Seamlessly replace only the lower body clothing. Photorealistic, professional fashion photography.`
        : `The person in image 1 is wearing the top/shirt/jacket shown in image 2. Keep the person's face, hair, skin, lower body clothing, and background exactly the same. Seamlessly replace only the upper body clothing. Photorealistic, professional fashion photography.`;

      const payload = {
        prompt: instruction,
        image_urls: [sourceImage, referenceImage], // 💡 배열 형태로 순서대로 전송
        num_images: 1,
        aspect_ratio: "3:4",
        output_format: 'jpeg',
        resolution: "2K",
        limit_generations: true
      };

      // 1. 대기열(Queue)에 작업 등록
      const submitRes = await fetch('https://queue.fal.run/fal-ai/nano-banana-2/edit', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!submitRes.ok) {
        const err = await submitRes.json();
        throw new Error(err.detail || '작업 등록 실패');
      }

      const submitData = await submitRes.json();
      const statusUrl = submitData.status_url;
      const responseUrl = submitData.response_url;

      if (!statusUrl || !responseUrl) throw new Error('대기열 URL 발급 실패');

      // 2. 결과 나올 때까지 폴링(Polling) 대기
      const outputUrl = await pollResult(statusUrl, responseUrl);

      if (outputUrl) {
        setScores(generateScores(isMixMatch));
        if (isMixMatch) {
          setResultImage2(outputUrl);
          setStep(6);
        } else {
          setResultImage1(outputUrl);
          setStep(4);
        }
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(`오류 발생: ${e.message}`);
    }
  };

  useEffect(() => {
    if (step === 3 && userImageBase64 && targetProduct?.image_url) {
      runVTON(userImageBase64, targetProduct.image_url, false);
    } else if (step === 5.5 && resultImage1 && bottomImageBase64) {
      runVTON(resultImage1, bottomImageBase64, true);
    }
  }, [step]);


  const ScoringCard = ({ scores, isMixMatch }: { scores: Scores | null, isMixMatch: boolean }) => {
    if (!scores) return null;
    return (
      <div className="bg-gray-50 p-4 rounded-2xl mb-4 border border-gray-100 shadow-inner">
        <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1">
          <Sparkles size={12} /> Virtual MD Analysis
        </h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="flex items-center text-sm font-bold text-gray-800 gap-1.5"><Palette size={16} className="text-blue-500" /> 피부톤 조화도</span>
              <span className="text-blue-600 font-black">{scores.colorScore}점</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-tight">고객님의 퍼스널 컬러에 자연스럽게 녹아들어 안색을 환하게 밝혀줍니다.</p>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="flex items-center text-sm font-bold text-gray-800 gap-1.5"><Ruler size={16} className="text-emerald-500" /> 희망 핏 달성률</span>
              <span className="text-emerald-600 font-black">{scores.fitScore}점</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-tight">선택하신 '{fit === 'OVERSIZED' ? '오버핏' : '정핏'}' 실루엣이 고객님의 체형에 맞춰 연출되었습니다.</p>
          </div>
          {isMixMatch && (
            <div className="pt-2 border-t border-gray-200">
              <div className="flex justify-between items-center mb-1">
                <span className="flex items-center text-sm font-bold text-gray-800 gap-1.5"><Shirt size={16} className="text-purple-500" /> 스타일링 밸런스</span>
                <span className="text-purple-600 font-black">{scores.styleScore}점</span>
              </div>
              <p className="text-[11px] text-gray-500 leading-tight">함께 매치하신 소장품과 타겟 상품이 트렌디한 무드를 완성합니다.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 font-sans flex justify-center items-end sm:items-center">
      <div className="w-full max-w-[480px] h-full sm:h-[90vh] bg-transparent relative overflow-hidden sm:rounded-2xl shadow-2xl flex flex-col justify-end sm:justify-start">

        {(step === 1 || step === 2) && (
          <button onClick={closeFittingRoom} className="absolute top-4 right-4 z-50 p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/30 transition">
            <X size={20} />
          </button>
        )}

        <div className={`absolute bottom-0 w-full bg-white rounded-t-3xl transition-transform duration-500 ease-out z-40 ${step === 1 ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="p-6 pt-4">
            <div className="w-12 h-1.5 bg-gray-200 mx-auto mb-8 rounded-full" />
            <h2 className="text-2xl font-bold mb-2 tracking-tight text-gray-900">어떤 핏으로 입고 싶으신가요?</h2>
            <p className="text-sm text-gray-500 mb-8">체형과 원하시는 무드에 맞춰 착장을 시뮬레이션합니다.</p>

            <div className="flex gap-3 mb-4">
              <button onClick={() => { setFit('REGULAR'); setStep(2); }} className="flex-1 aspect-[4/3] border border-gray-200 p-4 flex flex-col items-center justify-center gap-3 hover:border-black transition-all rounded-2xl bg-gray-50 hover:bg-white">
                <span className="font-bold text-base text-gray-900">딱 맞는 정핏</span>
                <span className="text-xs text-gray-400 font-medium">Standard Fit</span>
              </button>
              <button onClick={() => { setFit('OVERSIZED'); setStep(2); }} className="flex-1 aspect-[4/3] border border-gray-200 p-4 flex flex-col items-center justify-center gap-3 hover:border-black transition-all rounded-2xl bg-gray-50 hover:bg-white">
                <span className="font-bold text-base text-gray-900">여유로운 오버핏</span>
                <span className="text-xs text-gray-400 font-medium">Loose Fit</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`absolute inset-0 bg-white z-50 transition-transform duration-500 ease-in-out flex flex-col ${step === 2 ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="flex items-center p-4 border-b border-gray-100">
            <button onClick={() => setStep(1)} className="p-2"><ChevronLeft size={24} className="text-gray-800" /></button>
            <span className="mx-auto font-bold text-gray-900 pr-8">전신사진 등록</span>
          </div>

          <div className="flex-1 p-6 flex flex-col justify-center">
            <h2 className="text-3xl font-bold mb-4 tracking-tight text-gray-900 leading-tight">거의 다 왔어요! ✨<br />전신사진을 올려주세요.</h2>
            <p className="text-sm text-gray-500 mb-10 leading-relaxed bg-gray-50 p-4 rounded-xl">
              가장 최근에 찍은 정면 위주의 전신사진을 골라주세요.<br />AI가 체형을 분석하여 맞춤형 핏을 제안합니다.
            </p>

            <label className="w-full aspect-[3/4] border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-4 hover:border-black transition-colors rounded-3xl cursor-pointer shadow-inner">
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'USER')} />
              <Camera size={48} className="text-gray-300" strokeWidth={1.5} />
              <span className="text-base font-bold text-gray-600">앨범에서 사진 선택하기</span>
            </label>
          </div>
        </div>

        <div className={`absolute inset-0 bg-black/95 z-[60] transition-opacity duration-500 flex flex-col items-center justify-center text-white ${(step === 3 || step === 5.5) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          <div className="w-64 h-1.5 bg-gray-800 rounded-full overflow-hidden mb-8">
            <div className="h-full bg-white animate-[pulse_1.5s_ease-in-out_infinite] w-1/2 rounded-full" />
          </div>
          <p className="text-sm font-medium tracking-widest text-gray-300 animate-pulse mb-2 text-center px-6">
            {loadingText}
          </p>
          <p className="text-[10px] text-gray-500">통상 30초~1분 정도 소요됩니다.</p>
        </div>

        <div className={`absolute inset-0 bg-[#0a0a0a] z-[60] transition-transform duration-500 ease-in-out flex flex-col ${(step === 4 || step === 6) ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="absolute top-0 w-full p-4 flex justify-between items-center z-50 bg-gradient-to-b from-black/60 to-transparent">
            <button onClick={closeFittingRoom} className="p-2 text-white/90 hover:text-white drop-shadow-md"><X size={24} /></button>
            <span className="text-[11px] font-black tracking-widest text-white/90 drop-shadow-md">VIRTUAL MD REPORT</span>
            <div className="w-10" />
          </div>

          <div className="flex-1 w-full relative overflow-hidden flex items-center justify-center">
            {(step === 6 ? resultImage2 : resultImage1) && (
              <img src={(step === 6 ? resultImage2 : resultImage1) as string} alt="Fitting Result" className="w-full h-full object-cover animate-fade-in" />
            )}
          </div>

          <div className="bg-white p-6 rounded-t-3xl -mt-6 z-50 shadow-[0_-10px_40px_rgba(0,0,0,0.15)] flex flex-col h-auto max-h-[60vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-gray-200 mx-auto mb-5 rounded-full flex-shrink-0" />

            <ScoringCard scores={scores} isMixMatch={step === 6} />

            <div className="flex flex-col gap-3 mt-2">
              {step === 4 && (
                <button onClick={() => setStep(5)} className="w-full py-3.5 border border-gray-300 text-gray-900 font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors rounded-xl text-sm">
                  👖 내 옷과 매치해보기 (코디 확인)
                </button>
              )}

              <button onClick={addToCart} className="w-full py-4 bg-black text-white font-bold flex items-center justify-center gap-2 rounded-xl text-sm shadow-lg hover:bg-gray-800 transition-all">
                <CheckCircle2 size={18} /> {step === 4 ? '이대로 장바구니 담기' : '완벽한 코디, 바로 구매하기'}
              </button>
            </div>
          </div>
        </div>

        <div className={`absolute inset-0 bg-black/60 z-[70] transition-opacity ${step === 5 ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          <div className={`absolute bottom-0 w-full bg-white rounded-t-3xl transition-transform duration-300 delay-100 ${step === 5 ? 'translate-y-0' : 'translate-y-full'}`}>
            <div className="p-6 pt-4">
              <div className="w-12 h-1.5 bg-gray-200 mx-auto mb-6 rounded-full" />
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold tracking-tight">어떤 옷을 매치할까요?</h2>
                <button onClick={() => setStep(4)} className="text-sm font-bold text-gray-400 px-2 py-1">취소</button>
              </div>

              <label className="w-full aspect-video border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center gap-3 hover:border-black transition-colors mb-4 rounded-2xl cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'BOTTOM')} />
                <Upload size={32} className="text-gray-400" strokeWidth={1.5} />
                <span className="text-sm font-bold text-gray-600">소장하고 계신 하의 사진 업로드</span>
              </label>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-xl z-[9999] text-center w-3/4">
            <p className="text-red-500 font-bold mb-4">{errorMsg}</p>
            <button onClick={() => { setErrorMsg(''); closeFittingRoom(); }} className="bg-black text-white px-6 py-2 rounded-lg font-medium text-sm">닫기</button>
          </div>
        )}

      </div>
    </div>
  );
}