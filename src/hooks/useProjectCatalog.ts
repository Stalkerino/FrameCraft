import {useEffect, useState} from 'react';
import type {ProjectCatalog} from '../../shared/project-library';
import {projectApi} from '../services/project-api';
export function useProjectCatalog(revision: number) {
  const [catalog, setCatalog] = useState<ProjectCatalog | null>(null); const [error, setError] = useState('');
  useEffect(() => {let active = true; void projectApi.list().then(value => {if(active) {setCatalog(value); setError('');}}).catch(error => {if(active) setError(error.message);}); return () => {active = false;};}, [revision]);
  return {catalog, error};
}
