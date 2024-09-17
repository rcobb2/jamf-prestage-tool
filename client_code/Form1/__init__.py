from ._anvil_designer import Form1Template
from anvil import *
import anvil.server


class Form1(Form1Template):
  def __init__(self, **properties):
    # Set Form properties and Data Bindings.
    self.drop_down_1.items = [
       "first-time user prestage",
        "classroom test",
        "ous prestage",
        "transfer prestage test",
        "labs prestage",
        "loaner prestage",
        "classroom prestage",
        "faculty/staff prestage",
    ]
    self.preloadBuilding.items = [
        "100HA", "Alana", "Alum", "Arena", "Base", "Bent", "Bern", "Bookstore",
        "Bryan", "Burke", "Case", "Cooley", "Coop", "Curtis", "Dana", "DLMC",
        "Drake", "East", "Hasc", "Ho", "Hunt", "JBC", "JCC", "Keck", "Lath",
        "Lawr", "Ledge", "Litt", "Mcgr", "Ocon", "Olin", "Pers", "Pinch",
        "Reid", "Ryan", "Sanford", "Sap", "Security", "Serp", "Wynn"
    ]
    self.prestageID.visible = False
    self.prestageName.visible = False
    self.pID.visible = False
    self.pName.visible = False
    
    self.init_components(**properties)
    # Any code you write here will run before the form opens.
  
  def text_box_1_pressed_enter(self, **event_args):
    """This method is called when the user presses Enter in this text box"""
    compName, compID, compSN, compAsset, prestageID, prestageName, id, un, ea, building, room, at = anvil.server.call('get_target_computer', self.text_box_1.text)
    
    self.cName.text = f"{compName}"
    self.cSN.text = f"{compSN}"
    self.cAsset.text = f"{compAsset}"
    self.cID.text = f"{compID}"
    if prestageName != 0:
      self.prestageID.visible = True
      self.prestageName.visible = True
      self.pID.visible = True
      self.pName.visible = True
      self.pID.text = f"{prestageID}"
      self.pName.text = f"{prestageName}"
    else:
      self.prestageID.visible = False
      self.prestageName.visible = False
      self.pID.visible = False
      self.pName.visible = False
      self.pName.text = ""
      self.pID.text = ""
    self.id = id  
    self.preloadSN.text = f"{compSN}"
    self.preloadUN.text = f"{un}"
    self.preloadEA.text = f"{ea}"
    if building != None:
      self.preloadBuilding.selected_value = f"{building}"
    else:
      pass
    self.preloadRoom.text = f"{room}"
    self.preloadAT.text = f"{at}"
  
  def rmvPre_click(self, **event_args):
    """This method is called when the button is clicked"""
    c = confirm(f"Do you wish to remove {self.cName.text} from {self.pName.text}?")
    if c == True:
      rData = anvil.server.call('remove_from_computer_prestage', self.cSN.text, self.pID.text)
      alert(f"{rData}")
    else:
      return
  
  
  def rplPre_click(self, **event_args):
    """This method is called when the button is clicked"""
    c = confirm(f"Do you wish to add {self.cName.text} to {self.drop_down_1.selected_value}?")
    if c == True:
      if self.pName.text != "0":
        rData = anvil.server.call('remove_from_computer_prestage', self.cSN.text, self.pID.text)
      else:
        pass
      targetPrestageName = self.drop_down_1.selected_value
      rData2 = anvil.server.call('add_to_computer_prestage', self.cSN.text, targetPrestageName)
      alert(f"{rData}\n{rData2}")
    else:
      return

  def button_1_click(self, **event_args):
   #(id, compSN, un, ea, building, room, at)
    update = anvil.server.call('update_inventory_preload', self.id, self.preloadSN.text, self.preloadUN.text, self.preloadEA.text, self.preloadBuilding.selected_value, self.preloadRoom.text, self.preloadAT.text)
    alert(f"{update}")