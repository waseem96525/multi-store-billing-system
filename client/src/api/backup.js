import api from './client';

export const downloadBackup = async () => {
  const res = await api.get('/backup', { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `retail-pos-backup-${new Date().toISOString().slice(0, 10)}.db`;
  a.click();
  URL.revokeObjectURL(url);
};
