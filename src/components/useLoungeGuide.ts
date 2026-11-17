import { useEffect, useState } from 'react';
import { loungeRepository, type LoungeGuideResult } from '../lib/lounge-repository';

export function useLoungeGuide(airport: string) {
  const [result, setResult] = useState<LoungeGuideResult & { airport: string }>({
    airport: '',
    status: 'unavailable',
  });
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void loungeRepository.load(airport).then((value) => {
      if (active) {
        setResult({ ...value, airport });
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [airport, attempt]);
  return {
    ...result,
    data: result.airport === airport ? result.data : undefined,
    loading: loading || result.airport !== airport,
    catalog: loungeRepository.catalog,
    retry: () => setAttempt((value) => value + 1),
  };
}
