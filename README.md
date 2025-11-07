# Smart Cattle Health Monitoring Dashboard

A real-time web dashboard to monitor the health vitals of cattle using data streamed from an IoT sensor. This project provides a clean, responsive interface to visualize live data, ensuring timely insights into an animal's well-being.

![Dashboard Screenshot]([https://i.imgur.com/your-screenshot.png](https://raw.githubusercontent.com/neslang-05/cattlehealth/master/public/Dashboard_screenshot.png
)) 

## Features

-   **Real-time Data Display**: Live updates for Pulse, Internal Temperature, and External Temperature.
-   **Connection Status**: A visual indicator shows whether the dashboard is actively connected to the data source.
-   **Secure Configuration**: API keys and sensitive configuration are not exposed on the client-side. They are securely managed and served via a serverless function.
-   **Responsive Design**: The user interface is optimized for both desktop and mobile devices.
-   **Serverless Deployment**: Designed for easy and scalable deployment on platforms like Vercel.

---

## High-Level System Architecture

The system is composed of three primary components: an IoT sensor, a Firebase backend, and a web frontend.

1.  **IoT Sensor (The Data Source)**:
    -   An external hardware device (e.g., an ESP32, Arduino, or Raspberry Pi with sensors) is responsible for collecting health data from the cow.
    -   This device connects to the internet and pushes the collected data (pulse, temperature, etc.) to the Firebase Realtime Database.

2.  **Backend (Firebase)**:
    -   **Firebase Realtime Database** acts as the central, cloud-hosted message broker and data store.
    -   It receives data from the IoT sensor and streams it in real-time to any connected clients (our web dashboard).
    -   The data is structured under a specific path, such as `/cattle/cow_1/latest_reading`.

3.  **Frontend (Web Dashboard)**:
    -   A static web application built with **HTML, CSS, and vanilla JavaScript**.
    -   It is responsible for visualizing the data received from Firebase.
    -   It does **not** contain any hardcoded API keys. Instead, it fetches its configuration from a secure API endpoint.

---

## Connection Setup and Security

Securing API keys is critical. This project achieves this by abstracting the Firebase configuration into a serverless function, which is a best practice for modern web development.

Here is the step-by-step connection flow:

1.  **Client Request**: When a user opens the web dashboard, the client-side JavaScript makes a `fetch` request to a local API endpoint: `/api/config`.

2.  **Serverless Function Execution**:
    -   This request is routed by the hosting platform (Vercel) to a serverless function located in the `/api` directory.
    -   This function reads the Firebase project credentials from **Environment Variables** that are securely stored on Vercel, not in the git repository.

3.  **Secure Configuration Delivery**:
    -   The serverless function constructs the Firebase configuration object and sends it back to the client as a JSON response.

4.  **Firebase Initialization**:
    -   The client-side JavaScript receives the configuration object and uses it to initialize the connection to Firebase.

5.  **Real-time Data Subscription**:
    -   Once initialized, the application attaches a listener to the appropriate path in the Firebase Realtime Database.
    -   Firebase then pushes any data updates to the client instantly, which are then rendered on the screen.

This architecture ensures that sensitive credentials are never exposed in the public-facing source code, mitigating the risk of unauthorized access to your Firebase project.

---

## Local Development Setup

To run this project locally, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/neslang-05/cattlehealth.git
    cd cattlehealth
    ```

2.  **Install Vercel CLI:**
    You need the Vercel CLI to run the serverless function locally.
    ```bash
    npm install -g vercel
    ```

3.  **Create a local environment file:**
    Create a file named `.env.local` in the root of the project and add your Firebase credentials. This file is listed in `.gitignore` and will not be committed.

    ```plaintext
    # .env.local
    FIREBASE_API_KEY=AIzaSy...
    FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
    FIREBASE_DATABASE_URL=https://your-project.firebasedatabase.app
    FIREBASE_PROJECT_ID=your-project-id
    FIREBASE_STORAGE_BUCKET=your-project.appspot.com
    FIREBASE_MESSAGING_SENDER_ID=1234567890
    FIREBASE_APP_ID=1:12345:web:abcd...
    FIREBASE_MEASUREMENT_ID=G-ABC...
    ```

4.  **Run the development server:**
    Use the Vercel CLI to start the local development server.
    ```bash
    vercel dev
    ```
    This will start a server (usually on `http://localhost:3000`) that serves your static files and runs the serverless function.

---

## Deployment

This project is configured for seamless deployment to **Vercel**.

1.  **Push to GitHub**: Commit your code and push it to your GitHub repository.

2.  **Import Project on Vercel**:
    -   Log in to your Vercel account.
    -   Click "Add New... > Project".
    -   Import your GitHub repository.

3.  **Configure Environment Variables**:
    -   In the project settings on Vercel, navigate to **Settings > Environment Variables**.
    -   Add all the Firebase credentials from your `.env.local` file (e.g., `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, etc.).

4.  **Deploy**:
    -   Click the "Deploy" button. Vercel will automatically build and deploy your application. Your dashboard will be live at the provided URL.
