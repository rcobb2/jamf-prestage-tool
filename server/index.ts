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
app.use(express.json()); // Middleware to parse JSON bodies

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
app.get('/api/data/:search', async (req, res) => {
  const { search } = req.params;
  console.log(`Received request for search: ${search}`);
  try {
    const computers = await matchComputer(search);
    const token = await getToken();
    let allComputerData = [];

    if (computers.length === 0) {
      // No computers found, get Device Enrollment Instances
      const deviceEnrollmentInstancesUrl = `${baseUrl}/api/v1/device-enrollments?page=0&page-size=100&sort=id%3Aasc`;
      const deviceEnrollmentInstancesResponse = await axios.get(deviceEnrollmentInstancesUrl, {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${token}`
        }
      });

      const deviceEnrollmentInstances = deviceEnrollmentInstancesResponse.data.results;

      for (const instance of deviceEnrollmentInstances) {
        const instanceId = instance.id;
        const instanceDetailsUrl = `${baseUrl}/api/v1/device-enrollments/${instanceId}/devices`;
        const instanceDetailsResponse = await axios.get(instanceDetailsUrl, {
          headers: {
            accept: 'application/json',
            Authorization: `Bearer ${token}`
          }
        });

        const devices = instanceDetailsResponse.data.results;
        const matchedDevices = devices.filter(device => device.serialNumber.includes(search));

        const preloadDataPromises = matchedDevices.map(async (device) => {
          const { serialNumber } = device;

          // API call to fetch inventory preload records
          const preloadApiUrl = `${baseUrl}/api/v2/inventory-preload/records?page=0&page-size=100&sort=id%3Aasc&filter=serialNumber%3D%3D${serialNumber}`;
          const preloadResponse = await axios.get(preloadApiUrl, {
            headers: {
              Authorization: `Bearer ${token}`
            }
          });

          const preloadData = preloadResponse.data.results[0] || {}; // Assuming the first result is the relevant one
          const { id: preloadId, username, emailAddress, building, room } = preloadData;

          return {
            serial_number: serialNumber,
            preloadId, // Include the preload id
            username,
            email: emailAddress,
            building,
            room
          };
        });

        const instancePreloadData = await Promise.all(preloadDataPromises);
        allComputerData = allComputerData.concat(instancePreloadData);
      }
    } else {
      // Computers found, process the results
      const computerDataPromises = computers.map(async ({ id, serial_number }) => {
        const apiUrl = `${baseUrl}/api/v1/computers-inventory/${id}?section=GENERAL`;
        const response = await axios.get(apiUrl, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        const { id: computerId, general } = response.data;
        const name = general?.name || 'N/A';
        const assetTag = general?.assetTag || 'N/A';
        const objectName = general?.enrollmentMethod?.objectName || 'No Prestage Found.';

        const prestageAssignment = await getPrestageAssignments(serial_number);

        // New API call to fetch inventory preload records
        const preloadApiUrl = `${baseUrl}/api/v2/inventory-preload/records?page=0&page-size=100&sort=id%3Aasc&filter=serialNumber%3D%3D${serial_number}`;
        const preloadResponse = await axios.get(preloadApiUrl, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        const preloadData = preloadResponse.data.results[0] || {}; // Assuming the first result is the relevant one
        const { id: preloadId, username, emailAddress, building, room } = preloadData;

        return {
          computerId,
          name,
          assetTag,
          enrollmentObjectName: objectName,
          serial_number,
          currentPrestage: prestageAssignment.displayName,
          preloadId, // Include the preload id
          username,
          email: emailAddress,
          building,
          room
        };
      });

      allComputerData = await Promise.all(computerDataPromises);
    }

    console.log('All Computer Data:', allComputerData);

    if (allComputerData.length === 0) {
      res.status(404).send('No computers found');
    } else {
      res.json(allComputerData);
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).send('Error fetching data');
  }
});

// Endpoint to get prestages
app.get('/api/prestages', async (req, res) => {
  try {
    const prestages = await getPrestages();
    res.json(prestages);
  } catch (error) {
    res.status(500).send('Error fetching prestages');
  }
});

// Endpoint to get buildings
app.get('/api/buildings', async (req, res) => {
  try {
    const token = await getToken();
    const apiUrl = `${baseUrl}/api/v1/buildings?page=0&page-size=100&sort=id%3Aasc`;
    const response = await axios.get(apiUrl, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
    //console.log(response.data.results);
    res.json(response.data.results);
  } catch (error) {
    console.error('Error fetching buildings:', error);
    res.status(500).send('Failed to fetch buildings');
  }
});

// Endpoint to remove a device from a prestage
app.post('/api/remove-from-prestage', async (req, res) => {
  const { serialNumber, currentPrestage } = req.body;

  try {
    const prestages = await getPrestages();
    const prestage = prestages.find(p => p.displayName === currentPrestage);

    if (!prestage) {
      res.status(404).send('Prestage not found');
      return;
    }

    const token = await getToken();
    const options = {
      method: 'POST',
      url: `${baseUrl}/api/v2/computer-prestages/${prestage.id}/scope/delete-multiple`,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      data: {
        serialNumbers: [serialNumber],
        versionLock: prestage.versionLock
      }
    };

    const response = await axios.request(options);
    console.log('Remove from Prestage API Response:', response.data); // Log the response body

    res.json(response.data);

  } catch (error) {
    console.error('Error removing device from prestage:', error);
    res.status(500).send('Error removing device from prestage');
  }
});

// Endpoint to add a device to a prestage
app.post('/api/add-to-prestage', async (req, res) => {
  const { serialNumber, prestageId } = req.body;

  try {
    const prestages = await getPrestages();
    const prestage = prestages.find(p => p.id === prestageId);

    if (!prestage) {
      res.status(404).send('Prestage not found');
      return;
    }

    const token = await getToken();
    const options = {
      method: 'POST',
      url: `${baseUrl}/api/v2/computer-prestages/${prestage.id}/scope`,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      data: {
        serialNumbers: [serialNumber],
        versionLock: prestage.versionLock
      }
    };

    const response = await axios.request(options);
    //console.log('Add to Prestage API Response:', response.data); // Log the response body
    res.json(response.data);
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.error('Error adding device to prestage:', error);
      res.status(400).send('Please remove from current prestage before adding');
    } else {
      console.error('Error adding device to prestage:', error);
      res.status(500).send('Error adding device to prestage');
    }
  }
});

// Endpoint to update Preload information
app.put('/api/update-preload/:preloadId/:computerId', async (req, res) => {
  const { preloadId, computerId } = req.params;
  const { serialNumber, username, emailAddress, building, room, assetTag, buildingId } = req.body;

  const updateData = {
    deviceType: 'Computer',
    serialNumber,
    username,
    emailAddress,
    building, // Use the selected building name
    room,
    assetTag  // Added assetTag for preload data
  };

  const computerUpdateData = {
    general: { assetTag }, // assetTag is independent of serialnumber
    userAndLocation: {
      username,
      email: emailAddress,
      buildingId, // Use the selected building ID
      room
    }
  };

  try {
    const token = await getToken();
    let preloadResponse;
    let computerResponse;

    // Update or create preload record
    if (preloadId && preloadId !== 'null') {
      const preloadApiUrl = `${baseUrl}/api/v2/inventory-preload/records/${preloadId}`;
      preloadResponse = await axios.put(preloadApiUrl, updateData, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
    } else {
      const preloadApiUrl = `${baseUrl}/api/v2/inventory-preload/records`;
      preloadResponse = await axios.post(preloadApiUrl, updateData, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
    }

    // Update computer information
    try {
      const computerApiUrl = `${baseUrl}/api/v1/computers-inventory-detail/${computerId}`;
      computerResponse = await axios.patch(computerApiUrl, computerUpdateData, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      res.json({ preloadResponse: preloadResponse.data, computerResponse: computerResponse.data });
    } catch (computerError) {
      console.error('Error updating computer information:', computerError);
      res.json({ preloadResponse: preloadResponse.data, computerResponse: null, error: 'Failed to update computer information' });
    }
  } catch (preloadError) {
    console.error('Error updating/creating preload information:', preloadError);

    if (preloadError.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Error response data:', preloadError.response.data);
      console.error('Error response status:', preloadError.response.status);
      console.error('Error response headers:', preloadError.response.headers);
      res.status(preloadError.response.status).send(preloadError.response.data);
    } else if (preloadError.request) {
      // The request was made but no response was received
      console.error('Error request data:', preloadError.request);
      res.status(500).send('No response received from the server');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', preloadError.message);
      res.status(500).send('Error in setting up the request');
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