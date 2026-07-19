/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Desactivamos la minificación SWC si da algún problema con WebAuthn, pero por defecto funciona excelente
};

export default nextConfig;
