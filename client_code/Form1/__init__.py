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
    self.prestageID.visible = False
    self.prestageName.visible = False
    self.pID.visible = False
    self.pName.visible = False
    
    self.init_components(**properties)
    # Any code you write here will run before the form opens.
  
  def text_box_1_pressed_enter(self, **event_args):
    """This method is called when the user presses Enter in this text box"""
    compName, compID, compSN, compAsset, prestageID, prestageName = anvil.server.call('get_target_computer', self.text_box_1.text)
    #tokentest = anvil.server.call('get_target_computer', self.text_box_1.text)
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
      self.pName.text = "0"

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
        targetPrestageName = self.drop_down_1.selected_value
        rData2 = anvil.server.call('add_to_computer_prestage', self.cSN.text, targetPrestageName)
        alert(f"{rData}\n{rData2}")
      else:
        targetPrestageName = self.drop_down_1.selected_value
        rData2 = anvil.server.call('add_to_computer_prestage', self.cSN.text, targetPrestageName)
        alert(f"{rData2}")
    else:
      return
