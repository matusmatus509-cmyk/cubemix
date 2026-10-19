import { planTransition } from './CubeSolver';
self.onmessage = ({data}) => {
  try { self.postMessage({moves: planTransition(data.from, data.to)}); }
  catch (error) { self.postMessage({error: error instanceof Error ? error.message : 'Riešenie zlyhalo.'}); }
};
