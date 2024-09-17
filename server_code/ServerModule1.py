import anvil.server
import requests
import time
import json
import xml.etree.ElementTree as ET

CLIENTID = '8945c5b1-caef-4223-9561-ebd25c4e71f8'
CLIENTSECRET ='nYUUrj1J0BdnDMht_0Lx9XaT-rkQbAZpvNYqbvoci0A1QlVsQ9cTGaRpdpwe7wCF'
URL = 'https://colgate.jamfcloud.com/'

@anvil.server.callable
def get_prestage_versionLock(URL, access_token, prestageID):
    endpoint = f"{URL}/api/v3/computer-prestages/{prestageID}"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
        }
    req = requests.get(endpoint, headers=headers)
    respdata = req.json()
    verLock = respdata['versionLock']
    return verLock

@anvil.server.callable
def remove_from_computer_prestage(compSN, prestageID):
    access_token = get_access_token(URL, CLIENTID, CLIENTSECRET)
    verLock = get_prestage_versionLock(URL, access_token, prestageID)
    endpoint = f"{URL}/api/v1/computer-prestages/{prestageID}/scope"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
        }
    payload = {
    "serialNumbers": [compSN],
    "versionLock": verLock
        }
    req = requests.delete(endpoint, json=payload, headers=headers)
    resp = req.status_code
    if resp != 200:
        rData = (f"Error removing {compSN} from prestage {prestageID}. Status Code: {resp}")
        return rData
    else:
        rData=(f"{compSN} removed from prestage {prestageID}")
        return rData

@anvil.server.callable
def add_to_computer_prestage(compSN, targetPrestageName):
    access_token = get_access_token(URL, CLIENTID, CLIENTSECRET)
    targetprestageID = get_prestageID(targetPrestageName)
    verLock = get_prestage_versionLock(URL, access_token, targetprestageID)
    endpoint = f"{URL}/api/v2/computer-prestages/{targetprestageID}/scope"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'accept': 'application/json',
        'Content-Type': 'application/json'
        }
    payload = {
    "serialNumbers": [compSN],
    'versionLock': verLock
        }
    req = requests.post(endpoint, json=payload, headers=headers)
    resp = req.status_code
    if resp != 200:
        rData2 = (f"Error adding {compSN} from prestage {targetPrestageName}. Status Code: {resp}")
        return rData2
    else:
        rData2 = print(f"{compSN} added to prestage {targetprestageID}")
        return rData2

@anvil.server.callable
def replace_computer_prestage(compSN, prestageID):
    access_token = get_access_token(URL, CLIENTID, CLIENTSECRET)
    verLock = get_prestage_versionLock(URL, access_token, prestageID)
    endpoint = f"{URL}/api/v2/computer-prestages/{prestageID}/scope"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
        }
    payload = {
    "serialNumbers": [compSN],
    "versionLock": verLock
        }
    req = requests.put(endpoint, json=payload, headers=headers)
    resp = req.json()
    return resp

@anvil.server.callable
def get_prestageID(targetPrestageName):
    prestageNames2ID = {
        "first-time user prestage" : 9,
        "classroom test" : 8,
        "ous prestage" : 7,
        "transfer prestage test" : 6,
        "labs prestage" : 5,
        "loaner prestage" : 4,
        "classroom prestage" : 3,
        "faculty/staff prestage" : 2,
    }
    #targetPrestageName = input("Enter the name of the prestage you want to assign this machine to: ")
    if targetPrestageName.lower() in prestageNames2ID:
        targetprestageID = prestageNames2ID[targetPrestageName.lower()]
        return targetprestageID
    else:
        return 0

@anvil.server.callable
def get_access_token(URL, CLIENTID, CLIENTSECRET):
    auth_url = f"{URL}/api/oauth/token"
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    body_params = {
        'client_id': CLIENTID,
        'grant_type': 'client_credentials',
        'client_secret': CLIENTSECRET
    }

    response = requests.post(auth_url, headers=headers, data=body_params)
    response_data = response.json()

    access_token = response_data.get('access_token')
    #token_expires_in = response_data.get('expires_in')
    #current_epoch = int(time.time())
    #token_expiration_epoch = current_epoch + token_expires_in - 1

    return access_token

@anvil.server.callable
def get_computer_id(URL, access_token, compInfo):
    endpoint = f"{URL}/JSSResource/computers/match/{compInfo}"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/xml'
        }
    req = requests.get(endpoint, headers=headers)
    xmldata = req.text
    root = ET.fromstring(xmldata)
    computer = root.find('computer')
    compName = computer.find('name').text
    compID = computer.find('id').text
    compSN = computer.find('serial_number').text
    compAsset = computer.find('asset_tag').text
    return compName, compID, compSN, compAsset       

@anvil.server.callable
def get_computer_prestage(URL, access_token, compSN):
    endpoint = f"{URL}/api/v2/computer-prestages/scope"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
        }
    req = requests.get(endpoint, headers=headers)
    respdata = req.json()
    prestageID = respdata["serialsByPrestageId"].get(compSN)
    prestageName = get_prestage_name(prestageID)
    return prestageID, prestageName


@anvil.server.callable
def get_prestage_name(prestageID):
    prestageID2Name = {
        "9" : "first-time user prestage",
        "8" : "classroom test",
        "7" : "ous prestage",
        "6" : "transfer prestage test",
        "5" : "labs prestage",
        "4" : "loaner prestage",
        "3" : "classroom prestage",
        "2" : "faculty/staff prestage"
    }

    if prestageID in prestageID2Name:
        prestageName = prestageID2Name[prestageID]
        return prestageName
    else:
        print(f"Prestage ID {prestageID} is not a valid prestage ID")
        return 0

@anvil.server.callable
def get_target_computer(compInfo):
    access_token = get_access_token(URL, CLIENTID, CLIENTSECRET)
    print("Token Success")
    compName, compID, compSN, compAsset = get_computer_id(URL, access_token, compInfo)
    print("compInfo success")  
    prestageID, prestageName = get_computer_prestage(URL, access_token, compSN)
    print("prestageInfo success")
  
    return compName, compID, compSN, compAsset, prestageID, prestageName 
  
"""
@anvil.server.callable
def get_action():
    actions = {
        "1": "Remove from prestage",
        "2": "Add to prestage",
        "3": "Replace prestage",
        "4": "Exit"
    }
    print("Select an operation to perform on the target machine:")
    for key, value in actions.items():
        print(f"{key}: {value}")

    action = input()

    if action in actions:
        #action = actions[action]
        return action
    else:
        print(f"Invalid action {action}")
        return get_action()
@anvil.server.callable
def do_action(action, access_token, compID, compSN, prestageID):
      match action:
        case "1":
            return remove_from_computer_prestage(URL, access_token, compSN, prestageID)
        case "2":
            targetprestageID, targetPrestageName = get_prestageID()
            return add_to_computer_prestage(URL, access_token, compSN, targetprestageID, targetPrestageName)
        case "3":
            targetprestageID, targetPrestageName = get_prestageID()
            remove_from_computer_prestage(URL, access_token, compSN, prestageID)
            return add_to_computer_prestage(URL, access_token, compSN, targetprestageID, targetPrestageName)
        case "4":
            return "Null"
        case _:
            print("Unknown action")
            return "Null"
"""