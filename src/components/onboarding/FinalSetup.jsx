import React, { useState } from 'react';
import { saveOnboardingData, getOnboardingData } from '../../utils/onboardingStorage';
import { supabase } from '../../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function FinalSetup() {
  const [companySettings, setCompanySettings] = useState({
    companyName: '',
    timezone: 'America/Bogota',
    currency: 'COP',
    workHours: '08:00 - 22:00'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      const fullData = {
        ...getOnboardingData(),
        companySettings,
        isComplete: true,
        completedAt: new Date().toISOString()
      };

      // 1. Guardar localmente primero (Local-First)
      saveOnboardingData(fullData);

      // 2. Sincronizar con Supabase si hay sesión activa
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            company_name: companySettings.companyName,
            timezone: companySettings.timezone,
            currency: companySettings.currency,
            onboarding_completed: true,
            onboarding_data: fullData
          });
      }

      // 3. Redirigir al Dashboard principal de VIMDY
      navigate('/dashboard');
    } catch (err) {
      setError('Error al finalizar: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="onboarding-step p-6 max-w-md mx-auto bg-white rounded-xl shadow-md">
      <h2 className="text-2xl font-bold mb-4">Configuración Final de VIMDY</h2>
      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}
      
      <div className="mb-4">
        <label className="block text-gray-700 font-medium mb-1">Nombre del Restaurante / Negocio</label>
        <input
          type="text"
          className="w-full p-2 border rounded"
          placeholder="Ej. Restaurante Sabor del Campo"
          value={companySettings.companyName}
          onChange={(e) => setCompanySettings({...companySettings, companyName: e.target.value})}
        />
      </div>

      <div className="mb-4">
        <label className="block text-gray-700 font-medium mb-1">Moneda</label>
        <select
          className="w-full p-2 border rounded"
          value={companySettings.currency}
          onChange={(e) => setCompanySettings({...companySettings, currency: e.target.value})}
        >
          <option value="COP">COP ($)</option>
          <option value="USD">USD ($)</option>
          <option value="MXN">MXN ($)</option>
          <option value="CLP">CLP ($)</option>
        </select>
      </div>

      <button
        onClick={handleFinish}
        disabled={isSubmitting}
        className="w-full bg-blue-600 text-white p-3 rounded font-bold hover:bg-blue-700 transition"
      >
        {isSubmitting ? 'Guardando y entrando...' : '¡Terminar y abrir VIMDY!'}
      </button>
    </div>
  );
}