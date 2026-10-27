export const ONBOARDING_KEY = 'vimdy_onboarding_data';

export const saveOnboardingData = (data) => {
  try {
    const existingData = getOnboardingData();
    const mergedData = { ...existingData, ...data };
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(mergedData));
    return mergedData;
  } catch (error) {
    console.error('Error saving onboarding data:', error);
    return null;
  }
};

export const getOnboardingData = () => {
  try {
    const data = localStorage.getItem(ONBOARDING_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Error getting onboarding data:', error);
    return {};
  }
};

export const isOnboardingComplete = () => {
  const data = getOnboardingData();
  return data.isComplete === true;
};