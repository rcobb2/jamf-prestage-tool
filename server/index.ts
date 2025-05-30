import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import https from 'https';
// import http from 'http';
dotenv.config(); // Load environment variables from .env file

const app = express();
const port: number = Number(process.env.PORT);
const baseUrl: string = process.env.BASE_URL as string;
const clientId: string = process.env.CLIENT_ID as string;
const clientSecret: string = process.env.CLIENT_SECRET as string;
const tokenUrl: string = `${baseUrl}/api/oauth/token`;

app.use(cors());
app.use(express.json());

// Load SSL certificates
const sslOptions: https.ServerOptions = {
  key: fs.readFileSync('/app/server.key'),
  cert: fs.readFileSync('/app/server.cert')
};

// Get the access token using client credentials
async function getToken(): Promise<string> {
  const data = [
    `grant_type=client_credentials`,
    `client_id=${encodeURIComponent(clientId)}`,
    `client_secret=${encodeURIComponent(clientSecret)}`
  ].join('&');

  try {
    const response = await axios.post<{ access_token: string }>(tokenUrl, data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data.access_token;
  } catch (error: any) {
    console.error('Failed to get access token:', error.message);
    throw error;
  }
}

// Type definition for the computer match response
type ComputerMatch = {
  id: number;
  serial_number: string;
};

// Function to match records and return JSS Id and Serial Number
async function matchComputer(search: string): Promise<ComputerMatch[]> {
  try {
    const token = await getToken();
    const apiUrl = `${baseUrl}/JSSResource/computers/match/${search}`;
    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.data && response.data.computers && Array.isArray(response.data.computers)) {
      return response.data.computers.map((item: any) => ({
        id: item.id,
        serial_number: item.serial_number
      })) as ComputerMatch[];
    } else {
      throw new Error('Unexpected response format');
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  }
}

// Function to get a serial number's assigned prestage
async function getPrestageAssignments(serialNumber: string): Promise<{ serialNumber: string; displayName: string }> {
  try {
    const token = await getToken();
    const apiUrl = `${baseUrl}/api/v2/computer-prestages/scope`;
    const response = await axios.get<{ serialsByPrestageId: Record<string, number> }>(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    });

    const assignments = response.data.serialsByPrestageId;
    const prestages = await getPrestages();
    const prestageId = assignments[serialNumber];

    if (prestageId) {
      const prestage = prestages.find((p: { id: number }) => p.id === prestageId);
      if (prestage) {
        return {
          serialNumber,
          displayName: prestage.displayName
        };
      }
    }
    return {
      serialNumber,
      displayName: 'Unassigned'
    };
  } catch (error) {
    console.error('Error fetching prestage assignments:', error);
    throw error;
  }
}

// Function to parse response and get the id field
function getIdField(computers: { id: number }[]): number[] {
  return computers.map(item => item.id);
}

// Function to get prestages from
async function getPrestages(): Promise<{ id: number; displayName: string; versionLock: string }[]> {
  try {
    const token = await getToken();
    const apiUrl = `${baseUrl}/api/v3/computer-prestages?page=0&page-size=100&sort=id%3Adesc`;
    const response = await axios.get<{ results: { id: number; displayName: string; versionLock?: string }[] }>(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    return response.data.results.map((prestage) => ({
      id: prestage.id,
      displayName: prestage.displayName,
      versionLock: prestage.versionLock || 'N/A'
    }));
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  }
}

// Endpoint to search for matching records and collate their data
app.get('/api/data/:search', async (req: express.Request, res: express.Response) => {
  const { search } = req.params as { search: string };
  try {
    const computers = await matchComputer(search);
    const token = await getToken();
    let results: any[] = [];

    if (computers.length === 0) {
      // Search device enrollments if no computers found
      const enrollmentsRes = await axios.get<{ results: any[] }>(
        `${baseUrl}/api/v1/device-enrollments?page=0&page-size=100`,
        {
          headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
        }
      );
      for (const instance of enrollmentsRes.data.results) {
        const devicesRes = await axios.get<{ results: any[] }>(
          `${baseUrl}/api/v1/device-enrollments/${instance.id}/devices`,
          {
            headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
          }
        );
        for (const device of devicesRes.data.results.filter((d: any) => d.serialNumber.includes(search))) {
          const preloadRes = await axios.get<{ results: any[] }>(
            `${baseUrl}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${device.serialNumber}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const preload = preloadRes.data.results[0] || {};
          results.push({
            serial_number: device.serialNumber,
            preloadId: preload.id,
            username: preload.username,
            email: preload.emailAddress,
            building: preload.building,
            room: preload.room
          });
        }
      }
    } else {
      // Found computers, get details
      results = await Promise.all(
        computers.map(async ({ id, serial_number }: { id: number; serial_number: string }) => {
          const [compRes, prestage, preloadRes] = await Promise.all([
            axios.get<{ id: number; general: any }>(
              `${baseUrl}/api/v1/computers-inventory/${id}?section=GENERAL`,
              {
                headers: { Authorization: `Bearer ${token}` }
              }
            ),
            getPrestageAssignments(serial_number),
            axios.get<{ results: any[] }>(
              `${baseUrl}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${serial_number}`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
          ]);
          const general = compRes.data.general || {};
          const preload = preloadRes.data.results[0] || {};
          return {
            computerId: compRes.data.id,
            name: general.name || 'N/A',
            assetTag: general.assetTag || 'N/A',
            enrollmentObjectName: general.enrollmentMethod?.objectName || 'No Prestage Found.',
            serial_number,
            currentPrestage: prestage.displayName,
            preloadId: preload.id,
            username: preload.username,
            email: preload.emailAddress,
            building: preload.building,
            room: preload.room
          };
        })
      );
    }

    if (results.length === 0) {
      res.status(404).send('No computers found');
    } else {
      res.json(results);
    }
  } catch (error) {
    res.status(500).send('Error fetching data');
  }
});

// Endpoint to get prestages
app.get('/api/prestages', async (req: express.Request, res: express.Response) => {
  try {
    const prestages = await getPrestages();
    res.json(prestages);
  } catch (error) {
    res.status(500).send('Error fetching prestages');
  }
});

// Endpoint to get buildings
app.get('/api/buildings', async (req: express.Request, res: express.Response) => {
  try {
    const token = await getToken();
    const apiUrl = `${baseUrl}/api/v1/buildings?page=0&page-size=100&sort=id%3Aasc`;
    const response = await axios.get<{ results: any[] }>(apiUrl, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
    res.json(response.data.results);
  } catch (error) {
    console.error('Error fetching buildings:', error);
    res.status(500).send('Failed to fetch buildings');
  }
});

// Endpoint to remove a device from a prestage
app.post('/api/remove-from-prestage', async (req: express.Request, res: express.Response) => {
  const { serialNumber, currentPrestage } = req.body as { serialNumber: string; currentPrestage: string };

  try {
    const prestages = await getPrestages();
    const prestage = prestages.find(p => p.displayName === currentPrestage);
    if (!prestage) {
      res.status(404).send('Prestage not found');
      return;
    }

    const token = await getToken();
    const response = await axios.post(
      `${baseUrl}/api/v2/computer-prestages/${prestage.id}/scope/delete-multiple`,
      {
        serialNumbers: [serialNumber],
        versionLock: prestage.versionLock
      },
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error removing device from prestage:', error);
    res.status(500).send('Error removing device from prestage');
  }
});

// Endpoint to add a device to a prestage
app.post('/api/add-to-prestage', async (req: express.Request, res: express.Response) => {
  const { serialNumber, prestageId } = req.body as { serialNumber: string; prestageId: number };

  try {
    const prestages = await getPrestages();
    const prestage = prestages.find(p => p.id === prestageId);
    if (!prestage) {
      res.status(404).send('Prestage not found');
      return;
    }

    const token = await getToken();
    const response = await axios.post(
      `${baseUrl}/api/v2/computer-prestages/${prestage.id}/scope`,
      {
        serialNumbers: [serialNumber],
        versionLock: prestage.versionLock
      },
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );
    res.json(response.data);
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 400) {
      res.status(400).send('Please remove from current prestage before adding');
      return;
    }
    res.status(500).send('Error adding device to prestage');
  }
});

// Endpoint to update Preload information
app.put('/api/update-preload/:preloadId/:computerId', async (req: express.Request, res: express.Response) => {
  const { preloadId, computerId } = req.params as { preloadId: string; computerId: string };
  const {
    serialNumber,
    username,
    emailAddress,
    building,
    room,
    assetTag,
    buildingId
  }: {
    serialNumber: string;
    username: string;
    emailAddress: string;
    building: string;
    room: string;
    assetTag: string;
    buildingId: number;
  } = req.body;

  const preloadData = {
    deviceType: 'Computer',
    serialNumber,
    username,
    emailAddress,
    building,
    room,
    assetTag
  };

  const computerData = {
    general: { assetTag },
    userAndLocation: {
      username,
      email: emailAddress,
      buildingId,
      room
    }
  };

  try {
    const token = await getToken();

    // Update or create preload record
    const preloadApiUrl =
      preloadId && preloadId !== 'null'
        ? `${baseUrl}/api/v2/inventory-preload/records/${preloadId}`
        : `${baseUrl}/api/v2/inventory-preload/records`;

    const preloadMethod = preloadId && preloadId !== 'null' ? 'put' : 'post';
    const preloadResponse = await (axios as any)[preloadMethod](preloadApiUrl, preloadData, {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    // Update computer information
    try {
      const computerApiUrl = `${baseUrl}/api/v1/computers-inventory-detail/${computerId}`;
      const computerResponse = await axios.patch(computerApiUrl, computerData, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      res.json({ preload: preloadResponse.data, computer: computerResponse.data });
    } catch {
      res.json({ preload: preloadResponse.data, computer: null, error: 'Failed to update computer information' });
    }
  } catch (err: any) {
    const { response } = err;
    if (response) {
      res.status(response.status).send(response.data);
    } else {
      res.status(500).send('Error updating preload/computer information');
    }
  }
});

// Create HTTPS server
https.createServer(sslOptions, app).listen(port, () => {
  console.log(`Secure server is running on https://localhost:${port}`);
});

// Redirect HTTP to HTTPS
// http.createServer((req, res) => {
//     res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
//     res.end();
// }).listen(80, () => {
//     console.log('Redirecting HTTP to HTTPS');
// });