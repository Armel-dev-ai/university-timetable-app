import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.emploidutemps.app',
  appName: 'Emploi du temps',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#F2F3F4',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#F2F3F4',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#5B626B',
    },
  },
};

export default config;
