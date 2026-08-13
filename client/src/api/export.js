import api from './client';

export const exportCsv = async (entity) => {
  const res = await api.get(`/export/${entity}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${entity}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
