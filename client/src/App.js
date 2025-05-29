import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { loginRequest } from './authConfig';
import './App.css'; // Import the CSS file

const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5050';
console.log('Server URL:', serverUrl);


const App = () => {
  const { instance } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [searchId, setSearchId] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prestages, setPrestages] = useState([]);
  const [selectedPrestage, setSelectedPrestage] = useState('');
  const [notification, setNotification] = useState('');
  const [buildings, setBuildings] = useState([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [selectedBuildingName, setSelectedBuildingName] = useState('');

  useEffect(() => {
    async function initializeAuth() {
      try {
        console.log("Initializing authentication process...");

        const accounts = instance.getAllAccounts();
        //console.log("Accounts in MSAL cache:", accounts);

        if (accounts.length === 0) {
          //console.log("No accounts found. Triggering loginPopup.");
          await instance.initialize(); // Ensure the instance is initialized (optional for some configurations).
          const loginResponse = await instance.loginPopup(loginRequest);
          //console.log("Login successful:", loginResponse);
        }
      } catch (error) {
        console.error("Login error:", error);
      }
    }

    initializeAuth();
  }, [isAuthenticated, instance]);


  useEffect(() => {
    if (isAuthenticated) {
      console.log("User is authenticated. Fetching prestages and buildings.");
      fetchPrestages();
      fetchBuildings(); // Fetch buildings data
    }
  }, [isAuthenticated]);

  const fetchPrestages = async () => {
    try {
      const response = await axios.get(`${serverUrl}/api/prestages`);
      setPrestages(response.data);
    } catch (error) {
      console.error("Error fetching prestages:", error);
    }
  };

  const fetchBuildings = async () => {
    try {
      const response = await axios.get(`${serverUrl}/api/buildings`);
      console.log('Buildings fetched:', response.data); // Debugging line
      setBuildings(response.data);
    } catch (error) {
      console.error("Error fetching buildings:", error);
    }
  };

  const handleInputChange = (e) => {
    setSearchId(e.target.value);
  };

  const handleSearch = async () => {
    try {
      const response = await axios.get(`${serverUrl}/api/data/${searchId}`, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        }
      });
      setData(response.data);
      setNotification('Search completed successfully.');
    } catch (error) {
      if (error.response && error.response.status === 404) {
        setNotification('No matching computers found.');
      } else {
        console.error('Error searching for data:', error);
        setNotification('An error occurred while searching for data.');
      }
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleRefresh = () => {
    handleSearch();
  };

  const handlePrev = () => {
    setCurrentIndex((prevIndex) => (prevIndex > 0 ? prevIndex - 1 : data.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prevIndex) => (prevIndex < data.length - 1 ? prevIndex + 1 : 0));
  };

  const handlePrestageChange = (e) => {
    setSelectedPrestage(e.target.value);
  };

  const handleAddToPrestage = async () => {
    const currentComputer = data[currentIndex];
    const { serial_number } = currentComputer;

    try {
      const response = await axios.post(`${serverUrl}/api/add-to-prestage`, {
        serialNumber: serial_number,
        prestageId: selectedPrestage
      });
      console.log('Add to Prestage Response:', response.data);
      setNotification('Device successfully added to prestage.');
    } catch (error) {
      console.error('Error adding to prestage:', error);
      if (error.response && error.response.status === 400 && error.response.data === 'Please remove from current prestage before adding') {
        setNotification('Please remove from current prestage before adding.');
      } else {
        setNotification('Failed to add device to prestage.');
      }
    }
  };

  const handleRemoveFromPrestage = async () => {
    const currentComputer = data[currentIndex];
    const { serial_number, enrollmentObjectName } = currentComputer;

    try {
      const response = await axios.post(`${serverUrl}/api/remove-from-prestage`, {
        serialNumber: serial_number,
        enrollmentObjectName
      });
      console.log('Remove from Prestage Response:', response.data);
      setNotification('Device successfully removed from prestage.');
    } catch (error) {
      console.error('Error removing from prestage:', error);
      setNotification('Failed to remove device from prestage.');
    }
  };

  const handleFieldChange = (e, field) => {
    const updatedData = [...data];
    updatedData[currentIndex][field] = e.target.value;
    setData(updatedData);
  };

  const handleUpdateInformation = async () => {
    const currentComputer = data[currentIndex];
    const { computerId, preloadId, serial_number, username, email, room, assetTag } = currentComputer;

    const updateData = {
      serialNumber: serial_number,
      username,
      emailAddress: email,
      building: selectedBuildingName, // Use the selected building name
      room,
      assetTag,
      buildingId: selectedBuildingId // Use the selected building ID
    };
    console.log('Update Data:', updateData);
    try {
      const response = await axios.put(`${serverUrl}/api/update-preload/${preloadId || 'null'}/${computerId}`, updateData, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        }
      });
      console.log('Update Preload Information Response:', response.data);

      if (response.data.computerResponse && response.data.preloadResponse) {
        setNotification('Both Inventory and Preload data were successfully updated.');
      } else if (response.data.preloadResponse && !response.data.computerResponse) {
        setNotification('Preload data was updated, but Inventory record was not found or failed.');
      } else if (!response.data.preloadResponse && response.data.computerResponse) {
        setNotification('Inventory record was found and updated, but Preload data failed.');
      } else {
        setNotification('Both Inventory and Preload data update failed.');
      }
    } catch (error) {
      console.error('Error updating preload information:', error);
      setNotification('Failed to update information.');
    }
  };

  const handleLogout = () => {
    console.log("Starting logout process.");
    instance.logoutPopup()
      .then(() => {
        console.log("Logout successful. Clearing session storage.");
        sessionStorage.clear();

        console.log("Fetching accounts post-logout to validate cache clearance.");
        const accounts = instance.getAllAccounts();
        //console.log("Accounts in MSAL cache after logout:", accounts);

        console.log("Reloading application.");
        window.location.reload();
      })
      .catch((error) => {
        console.error("Logout error:", error);
      });
  };

  const validateTokenState = async () => {
    console.log("Validating token state.");
    try {
      const accounts = instance.getAllAccounts();
      if (accounts.length > 0) {
        console.log("Attempting to acquire a token silently.");
        const tokenResponse = await instance.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0],
        });
        console.log("Silent token acquisition successful:", tokenResponse);
      } else {
        console.log("No accounts available for silent token acquisition.");
      }
    } catch (error) {
      console.error("Token acquisition error:", error);
      if (error.errorCode === "interaction_required") {
        console.log("Interaction required. Triggering loginPopup.");
        instance.loginPopup(loginRequest)
          .then((response) => {
            console.log("Login successful:", response);
          })
          .catch((loginError) => {
            console.error("Login error during interaction:", loginError);
          });
      }
    }
  };

  useEffect(() => {
    validateTokenState();
  }, []);

  const handleBuildingChange = (event) => {
    const selectedId = event.target.value;
    const selectedBuilding = buildings.find(building => building.id === selectedId);
    setSelectedBuildingId(selectedId);
    setSelectedBuildingName(selectedBuilding ? selectedBuilding.name : '');
  };

  useEffect(() => {
    if (data.length > 0 && buildings.length > 0) {
      const currentBuilding = data[currentIndex].building;
      const matchedBuilding = buildings.find(building => building.name === currentBuilding);
      if (matchedBuilding) {
        setSelectedBuildingId(matchedBuilding.id);
        setSelectedBuildingName(matchedBuilding.name);
      }
    }
  }, [data, buildings, currentIndex]);


  if (!isAuthenticated) {
    return <div className="loading">Authenticating... Please wait.</div>;
  }

  return (
    <div className="App">
      <h1>Jamf Prestage Tool</h1>
      <button onClick={handleLogout}>Logout</button>
      <input
        type="text"
        value={searchId}
        onChange={handleInputChange}
        onKeyPress={handleKeyPress}
        placeholder="Enter search ID"
      />
      <button onClick={handleSearch}>Search</button>
      <button onClick={handleRefresh}>Refresh</button>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      {data.length > 0 && (
        <div className="card">
          <button onClick={handlePrev}>&lt;</button>
          <div className="card-content">
            <div className="card-column">
              <p><span className="text-highlight">Computer Details:</span></p>
              <p>Computer ID: <span className="text-highlight">{data[currentIndex].computerId}</span></p>
              <p>Computer Name: <span className="text-highlight">{data[currentIndex].name}</span></p>
              <p>Computer Serial: <span className="text-highlight">{data[currentIndex].serial_number}</span></p>
              <p>Last Run Prestage: <span className="text-highlight">{data[currentIndex].enrollmentObjectName}</span></p>
              <p>Current Prestage: <span className="text-highlight">{data[currentIndex].currentPrestage}</span></p>
            </div>
            <div className="card-column">
              <p><span className="text-highlight">Preload Details:</span></p>
              <p>Username: <input type="text" value={data[currentIndex].username} onChange={(e) => handleFieldChange(e, 'username')} /></p>
              <p>Email: <input type="text" value={data[currentIndex].email} onChange={(e) => handleFieldChange(e, 'email')} /></p>
              <p>Asset Tag: <input type="text" value={data[currentIndex].assetTag} onChange={(e) => handleFieldChange(e, 'assetTag')} /></p>
              <p>Building:
                <select value={selectedBuildingId} onChange={handleBuildingChange}>
                  <option value="">Select a building</option>
                  {buildings.map((building) => (
                    <option key={building.id} value={building.id}>
                      {building.name}
                    </option>
                  ))}
                </select>
              </p>
              <p>Room: <input type="text" value={data[currentIndex].room} onChange={(e) => handleFieldChange(e, 'room')} /></p>
            </div>
          </div>
          <button onClick={handleNext}>&gt;</button>
          <div className="counter">
            {currentIndex + 1} of {data.length}
          </div>
        </div>
      )}
      {prestages.length > 0 && (
        <div className="dropdown">
          <label htmlFor="prestages">Select Prestage:</label>
          <select id="prestages" value={selectedPrestage} onChange={handlePrestageChange}>
            <option value="">Select a Prestage</option>
            {prestages.map(prestage => (
              <option key={prestage.id} value={prestage.id}>
                {prestage.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="button-group">
        <button className="remove-button" onClick={handleRemoveFromPrestage}>Remove from Prestage</button>
        <button className="add-button" onClick={handleAddToPrestage}>Add to Prestage</button>
        <button className="update-button" onClick={handleUpdateInformation}>Update Preload Information</button>
      </div>
      {notification && <p className="notification">{notification}</p>}
    </div>
  );
};

export default App;